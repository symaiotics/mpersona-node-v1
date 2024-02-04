const { Readable } = require("stream");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

// Establish the AI Services
const services = {
  openAi: !!process.env.OPENAI_API_KEY,
  azureOpenAi: !!process.env.AZURE_OPENAI_KEY,
  anthropic: !!process.env.ANTHROPIC_API_KEY,
};

// Clients for AI services
const openai = services.openAi
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const anthropic = services.anthropic
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
    const { provider, uuid, session, model, messageHistory, userPrompt, systemPrompt, temperature } =
      promptConfig;

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
        const responseStream = await handleOpenAiPrompt({
          model,
          messages,
          temperature: parseFloat(temperature) || 0.5,
          stream: true,
        });
        await handlePromptResponse(responseStream, provider, uuid, session);
      } else if (services.anthropic && provider === "anthropic") {
        const responseStream = await handleAnthropicPrompt({
          model,
          messages,
          temperature: parseFloat(temperature) || 0.5,
          stream: true,
        });
        await handlePromptResponse(responseStream, provider, uuid, session);
      } else if (services.azureOpenAi && provider === "azureOpenAi") {
        const responseStream = await handleAzureOpenAiPrompt(model, messages, {
          temperature: parseFloat(temperature) || 0.5,
        });
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

  const handleOpenAiPrompt = async (promptConfig) => {
    const responseStream = await openai.chat.completions.create(promptConfig);
    return responseStream;
  };

  const handleAnthropicPrompt = async (promptConfig) => {
    let anthropicPrompt = {model:promptConfig.model, temperature:promptConfig.temperature, stream:true}
    anthropicPrompt.prompt = formatAnthropic(promptConfig.messages);
    anthropicPrompt.max_tokens_to_sample = 4096;
    console.log("promptConfig.messages", promptConfig.messages)
    console.log("anthropicPrompt", anthropicPrompt)
    const responseStream = await anthropic.completions.create(anthropicPrompt);
    return responseStream;
  };

  const handleAzureOpenAiPrompt = async (model, messages, promptConfig) => {
    console.log({model, messages, promptConfig})
    const responseStream = await azureOpenAiClient.listChatCompletions(
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
    // Establish a unique ID for this client
    ws.uuid = uuidv4();
    clients[ws.uuid] = ws; // Store the WebSocket instance by UUID
    ws.send(JSON.stringify({ uuid: ws.uuid }));
    console.log(`Client connected ${ws.uuid}`);

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.uuid) {
          if (data.type === "ping") {
            sendToClient(data.uuid, data.session, "pong");
          } else if (data.type === "prompt") {
            // Construct promptConfig from the received data
            const promptConfig = {
              username: data.username,
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
            // Call handlePrompt with the constructed promptConfig
            handlePrompt(promptConfig);
          } else {
            sendToClient(
              data.uuid,
              data.session,
              "error",
              "Unrecognized message type"
            );
          }
        } else {
          ws.send(
            JSON.stringify({ message: "UUID is missing from the message" })
          );
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

  return { wss, sendToClient, handlePrompt };
};

module.exports = { createWebSocketServer };
