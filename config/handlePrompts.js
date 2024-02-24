const { Readable } = require("stream");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

// User management for API keys and user tokens
const Account = require("../models/account");
const { authenticateAndDecode } = require("../middleware/verify");
 
async function incrementUsedCharacters(account, characters) {
  try {
    // console.log("incrementUsedCharacters", characters);
    await Account.updateOne(
      { uuid: account.uuid },
      { $inc: { charactersUsed: characters } }
    );
  } catch (error) {
    console.error("Error incrementing used characters:", error);
  }
}

async function incrementOwnUsedCharacters(account, characters) {
  try {
    // console.log("incrementOwnUsedCharacters", characters);
    await Account.updateOne(
      { uuid: account.uuid },
      { $inc: { ownCharactersUsed: characters } }
    );
  } catch (error) {
    console.error("Error incrementing own used characters:", error);
  }
}

// Establish the AI Services
const services = {
  openAi:
    process.env.OPENAI_API_KEY !== undefined &&
    process.env.OPENAI_API_KEY !== "",
  azureOpenAi:
    process.env.AZURE_OPENAI_KEY !== undefined &&
    process.env.AZURE_OPENAI_KEY !== "",
  anthropic:
    process.env.ANTHROPIC_API_KEY !== undefined &&
    process.env.ANTHROPIC_API_KEY !== "",
};

// Clients for AI services
const openAiClient = services.openAi
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const anthropicClient = services.anthropic
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const azureOpenAiClient = services.azureOpenAi
  ? new OpenAIClient(
      process.env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_OPENAI_KEY)
    )
  : null;

// Helper functions
const hasMatchingApiKey = (account, provider) => {
  return (
    (provider === "openAi" && account?.openAiApiKey) ||
    (provider === "anthropic" && account?.anthropicApiKey) ||
    (provider === "azureOpenAi" && account?.azureOpenAiApiKey)
  );
};

const hasEnoughTokens = (account, charactersNeeded) => {
  return (
    account &&
    account.charactersUsed + charactersNeeded <= account.characterReserve
  );
};

const calculateMessageLength = (data) => {
  if (data.messageHistory) {
    return data.messageHistory.reduce(
      (sum, obj) => sum + (obj.content?.length || 0),
      0
    );
  }
  return (data.userPrompt?.length || 0) + (data.systemPrompt?.length || 0);
};

const handlePrompt = async (promptConfig, sendToClient) => {
  const {
    account,
    provider,
    uuid,
    session,
    model,
    messageHistory,
    userPrompt,
    systemPrompt,
    temperature,
  } = promptConfig;

  // Main logic
  try {
    // Calculate the length of the message to be used
    const messageLength = calculateMessageLength(promptConfig);
    const isAccountApiKeyMatch =
      account && hasMatchingApiKey(account, provider);
    const isTokenSufficient = hasEnoughTokens(account, messageLength);

    // If the user has a matching API key, use their API key.
    if (isAccountApiKeyMatch) {
      await incrementOwnUsedCharacters(account, messageLength);
    } else if (account && !isTokenSufficient) {
      // User is logged in but does not have a matching API key and no tokens left
      sendToClient(
        uuid,
        session,
        "ERROR",
        "You've used your entire reserve of characters. Add your own API key to continue to use this service freely."
      );
      return;
    } else if (account) {
      // User is logged in, provider doesn't match the presence of an API key, but tokens are available
      await incrementUsedCharacters(account, messageLength);
    }
    // If the user is not logged in, their token is expired, or they have no matching key, the request is still processed.
    let responseStream;
    switch (provider) {
      case "openAi":
        if (!services.openAi) break;
        responseStream = await handleOpenAiPrompt(account, {
          model,
          messages: messageHistory || [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: parseFloat(temperature) || 0.5,
          stream: true,
        });
        await handlePromptResponse(responseStream, provider, uuid, session, sendToClient);
        break;
      case "anthropic":
        if (!services.anthropic) break;
        responseStream = await handleAnthropicPrompt(account, {
          model,
          messages: messageHistory || [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: parseFloat(temperature) || 0.5,
          stream: true,
        });
        await handlePromptResponse(responseStream, provider, uuid, session, sendToClient);
        break;
      case "azureOpenAi":
        if (!services.azureOpenAi) break;
        responseStream = await handleAzureOpenAiPrompt(
          account,
          model,
          messageHistory,
          {
            temperature: parseFloat(temperature) || 0.5,
          }
        );
        const stream = Readable.from(responseStream);
        handleAzureStream(stream, uuid, session, sendToClient);
        break;
      default:
        sendToClient(
          uuid,
          session,
          "ERROR",
          JSON.stringify({
            message: "Provider not supported or not activated.",
          })
        );
        break;
    }
  } catch (error) {
    sendToClient(uuid, session, "ERROR", JSON.stringify(error));
    console.error("Prompt error", error);
  }
};

const handleOpenAiPrompt = async (account, promptConfig) => {
  let client = openAiClient;
  if (account?.openAiApiKey)
    client = new OpenAI({ apiKey: account.openAiApiKey });
  const responseStream = await client.chat.completions.create(promptConfig);
  return responseStream;
};

const handleAnthropicPrompt = async (account, promptConfig) => {
  let client = anthropicClient;
  if (account?.anthropicApiKey)
    client = new Anthropic({ apiKey: account.anthropicApiKey });
  let anthropicPrompt = {
    model: promptConfig.model,
    temperature: promptConfig.temperature,
    stream: true,
  };
  anthropicPrompt.prompt = formatAnthropic(promptConfig.messages);
  anthropicPrompt.max_tokens_to_sample = 4096;
  const responseStream = await client.completions.create(anthropicPrompt);
  return responseStream;
};

const handleAzureOpenAiPrompt = async (
  account,
  model,
  messages,
  promptConfig
) => {
  let client = azureOpenAiClient;
  if (account?.azureOpenAiApiKey && account?.azureOpenAiApiEndpoint) {
    client = new OpenAIClient(
      azure.azureOpenAiApiEndpoint,
      new AzureKeyCredential(azure.azureOpenAiApiKey)
    );
  }
  const responseStream = await client.streamChatCompletions(
    model,
    messages,
    promptConfig
  );
  return responseStream;
};

const handlePromptResponse = async (
  responseStream,
  provider,
  uuid,
  session, 
  sendToClient
) => {
  for await (const part of responseStream) {
    try {
      if (provider === "openAi" && part?.choices?.[0]?.delta?.content) {
        sendToClient(uuid, session, "message", part.choices[0].delta.content);
      } else if (
        provider === "anthropic" &&
        part.completion &&
        !part.stop_reason
      ) {
        sendToClient(uuid, session, "message", part.completion);
      } else {
        sendToClient(uuid, session, "EOM", null);
      }
    } catch (error) {
      sendToClient(uuid, session, "ERROR", JSON.stringify(error));
      console.error("Could not process stream message", error);
    }
  }
};

const handleAzureStream = (stream, uuid, session, sendToClient) => {
  stream.on("data", (event) => {
    event.choices.forEach((choice) => {
      if (choice.delta?.content !== undefined) {
        sendToClient(uuid, session, "message", choice.delta.content);
      }
    });
  });

  stream.on("end", () => sendToClient(uuid, session, "EOM", null));
  stream.on("error", (error) =>
    sendToClient(
      uuid,
      session,
      "ERROR",
      JSON.stringify({ message: "Stream error.", error: error.message })
    )
  );
};

function formatAnthropic(messageHistory) {
  let anthropicString = "";
  messageHistory.forEach((message, index) => {
    const prompt =
      message.role === "system"
        ? index === 0
          ? ""
          : Anthropic.AI_PROMPT
        : Anthropic.HUMAN_PROMPT;
    anthropicString += prompt + message.content;
  });
  anthropicString += Anthropic.AI_PROMPT;
  return anthropicString; // Return the resulting string
}
 
module.exports = {
  handlePrompt,
  // Export any other functions that are needed externally
};
