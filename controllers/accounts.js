//Accounts Controller
/*
The accounts controller contains the logic which processes API method received by the route
*/
//Load the specific controller plugins
const uuidv4 = require("uuid").v4;

//Error Handling
const ApiError = require("../error/ApiError");
const promiseHandler = require("../error/promiseHandler");

//Account Security
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

//Load the Models
const Artifact = require("../models/knowledgeMapping/Artifact.js");
const Category = require("../models/knowledgeMapping/Category.js");
const Document = require("../models/knowledgeMapping/Document.js");
const KnowledgeSet = require("../models/knowledgeMapping/KnowledgeSet.js");
const Mapping = require("../models/knowledgeMapping/Mapping");
const Segment = require("../models/knowledgeMapping/Segment");
const Tag = require("../models/knowledgeMapping/Tag");

const Account = require("../models/account");
const Persona = require("../models/Persona");
const Roster = require("../models/Roster");
const WorkStream = require("../models/WorkStream");
const Fact = require("../models/Fact");
const File = require("../models/File");

const MailingList = require("../models/MailingList");
const { createJWT } = require("../middleware/verify");

//File Upload and Downloads for Account Management
const JSZip = require('jszip');
const upload = require('../services/upload'); // Import the multer configuration
const fs = require('fs').promises; // Node.js File System module with Promises

exports.joinMailingList = async function (req, res, next) {
  try {
    let emailAddress = req.body.emailAddress || req.query.emailAddress;

    if (!emailAddress || !validateEmail(emailAddress)) {
      return res
        .status(400)
        .json({ message: "Invalid or No Email Address Provided" });
    }

    let newEmail = MailingList({ emailAddress });
    let result = await promiseHandler(newEmail.save(), 5000);

    if (result.success) {
      res.status(200).json({ message: "success", payload: result });
    } else {
      res.status(500).json({ message: "failure" });
    }
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

function validateEmail(email) {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

// Accepts a new account and saves it to the database
exports.createNewAccount = async function (req, res, next) {
  //Plaintext passwords are kept separate from new account
  var password =
    req.body.password || req.query.password || req.params.password || null;
  var password2 =
    req.body.password2 || req.query.password2 || req.params.password2 || null;

  //New account document created
  var newAccount = {
    uuid: uuidv4(),
    username:
      req.body.username || req.query.username || req.params.username || null,
    email: req.body.email || req.query.email || req.params.email || null,
    useCase:
      req.body.useCase || req.query.useCase || req.params.useCase || null,
    notes: req.body.notes || req.query.notes || req.params.notes || null,
    preferredLng:
      req.body.preferredLng ||
      req.query.preferredLng ||
      req.params.preferredLng ||
      "en",
    roles: ["user"],
    status: "active",
    momentCreated: new Date(),
  };

  //Verify the username is valid and not taken
  if (!newAccount.username) {
    console.log("No username found");
    return res
      .status(400)
      .send(JSON.stringify({ message: "noUsername", payload: null }));
  } else {
    var findAccount = await Account.findOne({ username: newAccount.username });
    if (findAccount) {
      console.log("User already exists");
      return res
        .status(400)
        .send(JSON.stringify({ message: "userExists", payload: null }));
    }
  }

  //Verify the password
  if (!password || password.length < 8 || password !== password2) {
    return res
      .status(400)
      .send(JSON.stringify({ message: "passwordsDontMatch", payload: null }));
  }

  //If everything checks out
  const salt = await bcrypt.genSalt(10);
  var hashedPassword = await bcrypt.hash(password, salt);
  newAccount.salt = salt;
  newAccount.password = hashedPassword;

  //Save the new account
  var doc = Account(newAccount);
  var results = await promiseHandler(doc.save(), 5000);

  //We need to return a result
  if (results.success) {
    //Mint a token and do the login at the same time
    var newToken = createJWT(results.success, req.fullUrl);
    res.header("auth-token", newToken.token);
    res.header("auth-token-decoded", JSON.stringify(newToken.tokenDecoded));
    res.status(200).send(
      JSON.stringify({
        message: "success",
        payload: {
          token: newToken.token,
          tokenDecoded: newToken.tokenDecoded,
        },
      })
    );
  } else
    res.status(500).send(JSON.stringify({ message: "failure", payload: null }));
};

// Login endpoint
exports.login = async function (req, res, next) {
  try {
    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
      throw ApiError.badRequest("Username and password are required.");
    }

    const account = await Account.findOne({ username });
    if (!account) {
      throw ApiError.notFound("Account not found.");
    }

    const passwordMatch = await bcrypt.compare(password, account.password);
    if (!passwordMatch) {
      throw ApiError.unauthorized("Incorrect password.");
    }

    // Update last login timestamp
    account.momentLastLogin = new Date();
    if (!account.momentFirstLogin) {
      account.momentFirstLogin = account.momentLastLogin;
    }
    await account.save();

    // Create and send the token
    const tokenInfo = { username: account.username, roles: account.roles };
    const newToken = createJWT(tokenInfo, "login");
    res.header("auth-token", newToken.token);
    res.header("auth-token-decoded", JSON.stringify(newToken.tokenDecoded));
    res
      .status(200)
      .json({ message: "Login successful", token: newToken.token });
  } catch (error) {
    next(error);
  }
};

// Own User Managed Account Functions
exports.accountOwn = async function (req, res, next) {
  try {
    let username = req.tokenDecoded.username;
    let accountInfo = await Account.findOne({
      username: username,
      status: "active",
    }).select({
      _id: 0,
      username: 1,
      email: 1,
      useCase: 1,
      notes: 1,
      preferredLng: 1,
      roles: 1,
      momentCreated: 1,
      momentLastLogin: 1,
      characterReserve: 1,
      charactersUsed: 1,
      openAiApiKey: 1,
      anthropicApiKey: 1,
      azureOpenAiApiKey: 1,
      azureOpenAiApiEndpoint: 1,

      //Optional subscription history, if running as a SaaS
      subscriptionType: 1,
      subscriptionDate: 1,
      subscriptionStatus: 1,
      subscriptionHistory: 1,
    });
    if (accountInfo) {
      res
        .status(200)
        .json({ message: "Here is the account info", payload: accountInfo });
    } else {
      return res
        .status(404)
        .json({ message: "No active account found", payload: null });
    }
  } catch (error) {
    next(error);
  }
};



exports.accountOwnUpdate = async function (req, res, next) {
  try {
    const username = req.tokenDecoded.username;
    let accountData = req.body.account || {};
    
    if (accountData.username !== username) {
      // Reject if the username in the body does not match the username from the token
      return res.status(403).json({ message: "Usernames do not match.", payload: null });
    }

    // Load the account info
    const account = await Account.findOne({ username: username, status: "active" });
    if (!account) {
      return res.status(404).json({ message: "No active account found", payload: null });
    }

    // Update the fields which have changed, excluding the username
    for (const key in accountData) {
      if (accountData.hasOwnProperty(key) && key !== 'username' && account[key] !== accountData[key]) {
        account[key] = accountData[key];
      }
    }

    // Save the updated account
    const updateResult = await account.save();

    if (updateResult) {
      res.status(200).json({ message: "Account updated", payload: updateResult });
    } else {
      res.status(500).json({ message: "Error updating account", payload: null });
    }
  } catch (error) {
    next(error);
  }
};

// Own User Managed Account Functions
exports.accountOwnDelete = async function (req, res, next) {
  try {
    let username = req.tokenDecoded.username;
    let deleteResult = await Account.deleteOne({
      username: username,
      status: "active",
    });

    if (deleteResult.deletedCount > 0) {
      res.status(200).json({ message: "Account deleted" });
    } else {
      return res
        .status(404)
        .json({ message: "No active account found", payload: null });
    }
  } catch (error) {
    next(error);
  }
};


// Own User Managed Account Functions
exports.accountOwnDataDownload = async function (req, res, next) {
  try {
    const username = req.tokenDecoded.username;
    const collections = [Artifact, Category, Document, KnowledgeSet, Mapping, Segment, Tag, Account, Persona, Roster, WorkStream, Fact, File];

    // Create a new zip instance
    const zip = new JSZip();

    // Query each collection and add individual JSON files to the zip
    for (const Collection of collections) {
      const documents = await Collection.find({
        $or: [
          { createdBy: username },
          { owners: username }
        ]
      }).lean(); // Use lean() for performance if you don't need Mongoose documents
      
      // Create a JSON string for the current collection's documents
      const jsonContent = JSON.stringify(documents, null, 2);
      // Add a new JSON file to the zip for the current collection
      zip.file(`${Collection.modelName}.json`, jsonContent);
    }

    // Generate the zip file as a Node.js buffer
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

    // Set the headers to indicate a file download
    const fileName = 'data.zip';
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-Type', 'application/zip');

    // Send the zip file
    res.send(zipContent);
  } catch (error) {
    next(error);
  }
};

// Own User Managed Account Functions
exports.accountOwnDataUpload = async function (req, res, next) {
  const username = req.tokenDecoded.username;

  upload.single('data')(req, res, async function (err) {
    if (err) {
      return next(err);
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    try {
      const zip = new JSZip();
      // Read the uploaded file from disk
      const zipContent = await fs.readFile(req.file.path);
      await zip.loadAsync(zipContent);

      const collections = {
        Artifact, Category, Document, KnowledgeSet, Mapping, Segment, Tag,
        Account, Persona, Roster, WorkStream, Fact, File
      };

      let rejections = [];

      // Iterate over each expected collection name
      for (const modelName in collections) {
        const Collection = collections[modelName];
        const jsonFile = zip.file(`${modelName}.json`);

        if (jsonFile) {
          // console.log('modelName', modelName)
          const jsonContent = await jsonFile.async('string');
          const documents = JSON.parse(jsonContent);

          for (const doc of documents) {
            try {
              // Override the owners, so they don't see this data duplicated
              delete doc._id;
              doc.uuid = uuidv4();
              doc.owners = [username];
              doc.createdBy = username;
              doc.publishStatus = 'unpublished'; //Not applicable for all collections 
              doc.publishedBy = null; // Not applicable for all collections
              doc.status = 'active';
              doc.momentCreated = new Date();
              // Insert each document, ignoring duplicates or validation errors
              await Collection.create(doc);
            } catch (error) {
              // Track the rejection but do not stop the loop
              rejections.push({ collection: modelName, document: doc, error: error.message });
            }
          }
        } else {
          rejections.push({ collection: modelName, error: 'File not found in the zip' });
        }
      }

      // Delete the uploaded file after processing
      await fs.unlink(req.file.path);

      // Send back a response with information about any rejections
      console.log("rejections", rejections)
      res.status(200).json({
        message: `Data upload completed with ${rejections.length} rejections`,
        payload: rejections
      });

    } catch (error) {
      // Delete the uploaded file in case of error
      console.log('error', error)
      if (req.file && req.file.path) {
        await fs.unlink(req.file.path);
      }
      next(error);
    }
  });
};



// Own User Managed Account Functions
exports.accountOwnDataDelete = async function (req, res, next) {
  try {
    const username = req.tokenDecoded.username;
    const collections = [Artifact, Category, Document, KnowledgeSet, Mapping, Segment, Tag, Account, Persona, Roster, WorkStream, Fact, File];

    let deletionResults = {};

    // Iterate over each collection and delete documents where the user is an owner
    for (const Collection of collections) {
      const deletionResult = await Collection.deleteMany({
        $or: [
          { owners: username }
        ]
      });

      // Store the result of the deletion for each collection
      deletionResults[Collection.modelName] = deletionResult;
    }

    // Send back a response with the deletion results
    res.status(200).json({
      message: "Data deletion completed",
      payload: deletionResults
    });

  } catch (error) {
    next(error);
  }
};



/////////////////ADMIN
//Get all account info
exports.allAccountInfo = async function (req, res, next) {
  try {
    let accountInfo = await Account.find({
      status: "active",
    }).select({
      _id: 0,
      username: 1,
      email: 1,
      useCase: 1,
      notes: 1,
      preferredLng: 1,
      roles: 1,
      momentCreated: 1,
      momentLastLogin: 1,
      characterReserve: 1,
      charactersUsed: 1,
      openAiApiKey: 1,
      anthropicApiKey: 1,
      azureOpenAiApiKey: 1,
      azureOpenAiApiEndpoint: 1,

      //Optional subscription history, if running as a SaaS
      subscriptionType: 1,
      subscriptionDate: 1,
      subscriptionStatus: 1,
      subscriptionHistory: 1,
    });

    if (accountInfo.length > 0) {
      res
        .status(200)
        .json({ message: "Here are all accounts info", payload: accountInfo });
    } else {
      return res.status(404).json({ message: "No active accounts found" });
    }
  } catch (error) {
    next(error);
  }
};

// Own User Managed Account Functions
exports.deleteAccounts = async function (req, res, next) {
  try {
    let usernames = req.body.usernames || [];
    if (!Array.isArray(usernames)) usernames = [usernames];
    let errors = 0;
    let deleted = 0;
    for (const username of usernames) {
      let accountInfo = await Account.deleteOne({
        username: username,
        status: "active",
      });
      if (accountInfo.deletedCount === 0) errors++;
      else deleted++;
    }
    // Check if any accounts were deleted
    if (deleted > 0) {
      res
        .status(200)
        .json({ message: "Accounts deleted", payload: { deleted, errors } });
    } else {
      res
        .status(404)
        .json({ message: "No active accounts found", payload: null });
    }
  } catch (error) {
    next(error);
  }
};
