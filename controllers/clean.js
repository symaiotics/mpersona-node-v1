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

const ApiError = require("../error/ApiError");
const logger = require("../middleware/logger");
const uuidv4 = require("uuid").v4;

exports.cleanCollectionsByKeyword = async function (req, res, next) {
  try {
    var keyword = req.body.keyword || req.query.keyword || null;

    // Define the specific aggregation pipeline
    const aggregationPipeline = [
      {
        $lookup: {
          from: "accounts",
          localField: "createdBy",
          foreignField: "username",
          as: "createdByAccount",
        },
      },
      {
        $lookup: {
          from: "accounts",
          localField: "editors",
          foreignField: "username",
          as: "editorAccount",
        },
      },
      {
        $lookup: {
          from: "accounts",
          localField: "owners",
          foreignField: "username",
          as: "ownerAccount",
        },
      },
      {
        $match: {
          $or: [
            { "createdByAccount.email": { $regex: keyword, $options: "i" } },
            { "createdByAccount.username": { $regex: keyword, $options: "i" } },
            { "editorAccount.email": { $regex: keyword, $options: "i" } },
            { "editorAccount.username": { $regex: keyword, $options: "i" } },
            { "ownerAccount.email": { $regex: keyword, $options: "i" } },
            { "ownerAccount.username": { $regex: keyword, $options: "i" } },
          ],
        },
      },
    ];
    // Define an array of models to process
    const models = [
      Artifact,
      Category,
      Document,
      KnowledgeSet,
      Mapping,
      Segment,
      Tag,
      Persona,
      Roster,
      WorkStream,
      Fact,
      File,
    ];

    // Variable to store the total count of deleted documents
    let totalModifiedCount = 0;

    // Process each model
    for (const model of models) {
      // Run the aggregation pipeline
      const documentsToDelete = await model.aggregate(aggregationPipeline);
      const idsToDelete = documentsToDelete.map((doc) => doc._id);
      console.log("idsToDelete", idsToDelete);

      // Delete documents with the collected _id values
      const updatedResults = await model.updateMany(
        {
          _id: { $in: idsToDelete },
        },
        { $set: { status: "inactive", active: false } }
      );
      totalModifiedCount += updatedResults.modifiedCount;

      logger.info(
        `Updated ${updatedResults.modifiedCount} documents from ${model.modelName} with ${keyword} in email or username.`
      );
    }

    // Now handle the Account collection separately
    const accountsToUpdate = await Account.find({
      $or: [
        { email: { $regex: keyword, $options: "i" } },
        { username: { $regex: keyword, $options: "i" } },
      ],
    });
    const accountIdsToUpdate = accountsToUpdate.map((doc) => doc._id);

    // Update accounts with the collected _id values
    const accountUpdateResults = await Account.updateMany(
      {
        _id: { $in: accountIdsToUpdate },
      },
      { $set: { status: "inactive", active: false } }
    );
    totalModifiedCount += accountUpdateResults.modifiedCount;
    logger.info(
      `Updated ${accountUpdateResults.modifiedCount} accounts from Accounts with ${keyword} in email or username.`
    );

    res.status(200).json({
      message: `Updated a total of ${totalModifiedCount} documents with ${keyword} in email or username across all collections.`,
    });
  } catch (error) {
    logger.error(
      `An error occurred while updating documents with ${keyword} in email or username across collections`,
      error
    );
    next(
      ApiError.internal(
        "An error occurred while deleting documents with 'fintrac' in email or username across collections"
      )
    );
  }
};
