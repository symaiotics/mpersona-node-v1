const { Readable } = require("stream");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

// User management for API keys and user tokens
const Account = require("../models/account");
const { authenticateAndDecode } = require("../middleware/verify");

async function verifyTokenAndAccount(token) {
  try {
    const tokenDecoded = authenticateAndDecode(token);
    if (!tokenDecoded) return null;
    return await Account.findOne({ username: tokenDecoded.username });
  } catch (error) {
    throw error;
  }
}

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
  openAi: process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY !== '',
  azureOpenAi: process.env.AZURE_OPENAI_KEY !== undefined && process.env.AZURE_OPENAI_KEY !== '',
  anthropic: process.env.ANTHROPIC_API_KEY !== undefined && process.env.ANTHROPIC_API_KEY !== '',
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

console.log("Services activated:", services);
console.log("Environment", process.env.NODE_ENV);

// Create a WebSocket server
const createWebSocketServer = (server) => {
  const wss = new WebSocket.Server({ server });
  const clients = {};

  const sendToClient = (uuid, session, type, message = null) => {
    const clientWs = clients[uuid];
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ session, type, message }));
    } else {
      console.error(`No open WebSocket found for UUID: ${uuid}`);
    }
  };

  const handlePrompt = async (promptConfig) => {
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

    //Configure for single or multiple chat memory
    let messages = [];
    if (messageHistory?.length) {
      messages = messageHistory;
    } else {
      messages = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ];
    }

    try {
      if (services.openAi && provider === "openAi") {
        const responseStream = await handleOpenAiPrompt(account, {
          model,
          messages,
          temperature: parseFloat(temperature) || 0.5,
          stream: true,
        });
        await handlePromptResponse(responseStream, provider, uuid, session);
      } else if (services.anthropic && provider === "anthropic") {
        const responseStream = await handleAnthropicPrompt(account, {
          model,
          messages,
          temperature: parseFloat(temperature) || 0.5,
          stream: true,
        });
        await handlePromptResponse(responseStream, provider, uuid, session);
      } else if (services.azureOpenAi && provider === "azureOpenAi") {
        const responseStream = await handleAzureOpenAiPrompt(
          account,
          model,
          messages,
          {
            temperature: parseFloat(temperature) || 0.5,
          }
        );
        const stream = Readable.from(responseStream);
        handleAzureStream(stream, uuid, session);
      } else {
        sendToClient(
          uuid,
          session,
          "ERROR",
          JSON.stringify({
            message: "Provider not supported or not activated.",
          })
        );
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
    // console.log("promptConfig.messages", promptConfig.messages);
    // console.log("anthropicPrompt", anthropicPrompt);
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
    session
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

  const handleAzureStream = (stream, uuid, session) => {
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

  // WebSocket server event handlers
  wss.on("connection", (ws) => {
    ws.uuid = uuidv4();
    clients[ws.uuid] = ws;
    ws.send(JSON.stringify({ uuid: ws.uuid }));
    console.log(`Client connected ${ws.uuid}`);

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);
        if (!data.uuid) {
          ws.send(JSON.stringify({ message: "UUID is missing from the message" }));
          return;
        }

        if (data.type === "ping") {
          sendToClient(data.uuid, data.session, "pong");
          return;
        }

        if (data.type !== "prompt") {
          sendToClient(data.uuid, data.session, "ERROR", "Unrecognized message type");
          return;
        }

        // Handle prompt message type
        let account = null;
        let hasCharacters = true;

        if (data.token) account = await verifyTokenAndAccount(data.token);
        // console.log("Account", account);

        const messageLength = calculateMessageLength(data);

        let useOwnKey = checkIfUsingOwnKey(account, data.provider);
        if (useOwnKey) {
          incrementOwnUsedCharacters(account, messageLength);
        } else {
          if (account && account.charactersUsed < account.characterReserve) {
            incrementUsedCharacters(account, messageLength);
          } else {
            hasCharacters = false;
            sendToClient(
              data.uuid,
              data.session,
              "ERROR",
              "You've used your entire reserve of characters. Add your own API key to continue to use this service freely."
            );
          }
        }

        if (hasCharacters) {
          const promptConfig = buildPromptConfig(data, account);
          handlePrompt(promptConfig);
        }
      } catch (error) {
        console.error("Failed to parse message:", error);
        ws.send(JSON.stringify({ message: "Error processing message" }));
      }
    });

    ws.on("close", () => {
      delete clients[ws.uuid];
    });
  });

  function calculateMessageLength(data) {
    if (data.messageHistory) {
      return data.messageHistory.reduce((sum, obj) => sum + (typeof obj.content === "string" ? obj.content.length : 0), 0);
    } else {
      return (data.userPrompt?.length || 0) + (data.systemPrompt?.length || 0);
    }
  }

  function checkIfUsingOwnKey(account, provider) {
    return (provider === "openAi" && account?.openAiApiKey) ||
           (provider === "anthropic" && account?.anthropicApiKey) ||
           (provider === "azureOpenAi" && account?.azureOpenAiApiKey && account?.azureOpenAiApiEndpoint);
  }

  function buildPromptConfig(data, account) {
    return {
      account,
      uuid: data.uuid,
      session: data.session,
      provider: data.provider || "openAi",
      model: data.model || "gpt-4",
      temperature: data.temperature,
      systemPrompt: data.systemPrompt,
      userPrompt: data.userPrompt,
      messageHistory: data.messageHistory,
      knowledgeSetUuids: data.knowledgeSetUuids,
    };
  }


  return { wss, sendToClient, handlePrompt };
};

module.exports = { createWebSocketServer };
