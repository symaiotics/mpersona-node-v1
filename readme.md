# mPersona
mPersona is a tool to build custom personas to facilitate interaction with Large Language Model services like Open AI's GPT4.

## About
mPersona is built in 2 parts, a Vue.js web interface and a Node.js server side application (this package).
The Node.js application uses the following key libraries
- bcrypt for JWT cryptography functions
- cors and helmet for web security
- dotenv for configuration
- jsonwebtoken for creating session tokens
- mongoDB and Mongoose ODM to persist models into a MongoDB or Azure CosmosDB (Mongo Driver) database
- openai to faclitate the OpenAI API connection
- ws for realtime websockets to facilitate token streams to the ui


## Configuration
The application also requires environment variables to operate

- NODE_ENV= //DEV or PROD
- PORT=3000 //Or any port you like
- DATASTORE=MongoDB //mPersona only runs MongoDB.
- TIMEOUT=30000 //timeout of requests
- JWT_SECRET=//Some cryptographically strong secret for signing JWTs
- MPERSONA_ATLAS=//Connection string
- AZURE_STORAGE_CONNECTION_STRING=//Storage connection string
- OPENAI_API_KEY=//OpenAI Key
- ANTHROPIC_API_KEY=//Anthropic Key
- AZURE_OPENAI_KEY=//Azure OpenAI Key
- AZURE_OPENAI_ENDPOINT=//Azure Endpoint
- MISTRAL_API_KEY=//Mistral Key, if applicable
- LOG_LEVEL=info
- CHARACTERS_RESERVE_DEFAULT=10000000

The storage account requires a container named /images to be created and publicly accessible as read only.

# Application Server License
The MIT License (MIT)

Copyright (c) 2023-current Symaiotics Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

