//Inherits KnowledgeSet permission and requires a knowledgeSetUuid for each transaction

const Account = require('../models/account.js');
const Persona = require('../models/Persona.js');
const ApiError = require('../error/ApiError');

const logger = require('../middleware/logger');
const uuidv4 = require('uuid').v4;
const packageInfo = require('../package.json');

exports.getStats = async function (req, res, next) {
    try {
        // Use countDocuments() to get the count of active documents
        const accountCount = await Account.countDocuments({active: true});
        const personaCount = await Persona.countDocuments({status: "active"});
        const version = packageInfo.version;

        // Send the counts as JSON response
        res.status(200).json({
            message: "Here are the counts of active documents",
            payload: {
                personas: personaCount,
                accounts: accountCount,
                version: version // Include the version in the response
            }
        });
    } catch (error) {
        next(ApiError.internal("An error occurred while retrieving document counts"));
    }
};
