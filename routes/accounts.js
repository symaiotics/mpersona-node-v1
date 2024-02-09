var router = require('express').Router();
const { isAuthenticated, isAdmin, renewToken } = require('../middleware/verify');

//Import the controller(s)
const accountsController = require('../controllers/accounts');

router.post('/',  accountsController.createNewAccount);
router.post('/login', accountsController.login);
router.post('/mailingList', accountsController.joinMailingList);

//Manage Accounts
router.get('/own/info',  [isAuthenticated, renewToken], accountsController.ownAccountInfo);
// router.post('/own/deleteAccount',  [isAuthenticated,  renewToken], accountsController.ownDeleteAccount);
// router.post('/own/downloadData',  [isAuthenticated, renewToken], accountsController.ownDownloadData);

//Admin functions
router.get('/allInfo',  [isAuthenticated, isAdmin, renewToken], accountsController.allAccountInfo);
// router.post('/deleteAccount',  [isAuthenticated, isAdmin, renewToken], accountsController.deleteAccount);

//export the router back to the index.js page
module.exports = router;