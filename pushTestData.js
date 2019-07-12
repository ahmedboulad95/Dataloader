"use strict";

const jsforce = require("jsforce");
const utilities = require("./utilities.js");
const logger = require("./logger.js");
const order = require("./objectOrder.js").order;

require('dotenv').config();

// Establish a connection to Salesforce
let loginOptions = { loginUrl: process.env.DEV_SF_DEST_ORG_URL };

let conn = new jsforce.Connection(loginOptions);
let recordObj = {};
let objMetadata = {};
let idMap = {};

let user = process.env.DEV_SF_DEST_ORG_USER;
let pass = process.env.DEV_SF_DEST_ORG_PASS;
let token = process.env.DEV_SF_DEST_ORG_TOKEN;

const logPath = "./logs/pushTestData.log";

logger.log(logPath, logger.debug.INFO, `Logging into ${loginOptions.loginUrl} as ${user}`);
conn.login(user, pass + token, function (err, userInfo) {
    if (err) {
        logger.log(logPath, logger.debug.ERROR, `Error logging in :: ${err}`);
        console.log("Error establishing connection. See logs for details");
        throw err;
    } 

    logger.log(logPath, logger.debug.INFO, `Logged into ${conn.instanceUrl} as ${userInfo.id}`);
    utilities.readFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.DATA_FILE_NAME)
        .then((data) => {
            if (!data) {
                logger.log(logPath, logger.debug.ERROR, `Error reading file: ./${process.env.DATA_FOLDER_NAME}/${process.env.DATA_FILE_NAME} does not exist or is corrupted`);
                console.log(`Error reading file ${process.env.DATA_FILE_NAME}. See logs for details`);
                logger.flush(logPath);
                throw "Data file not found or empty";
            }

            logger.log(logPath, logger.debug.INFO, `./${process.env.DATA_FOLDER_NAME}/${process.env.DATA_FILE_NAME} opened successfully`);
            recordObj = JSON.parse(data);
            logger.log(logPath, logger.debug.INFO, `Reading object metadata information from ./${process.env.DATA_FOLDER_NAME}/${process.env.METADATA_FILE_NAME}`);
            return utilities.readFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.METADATA_FILE_NAME);
        }).then((data) => {
            if (!data) {
                logger.log(logPath, logger.debug.ERROR, `Error reading file: ./${process.env.DATA_FOLDER_NAME}/${process.env.METADATA_FILE_NAME} does not exist or is corrupted`);
                console.log(`Error reading file ${process.env.METADATA_FILE_NAME}. See logs for details`);
                logger.flush(logPath);
                throw "Metadata file not found or empty";
            }

            logger.log(logPath, logger.debug.INFO, `./${process.env.DATA_FOLDER_NAME}/${process.env.METADATA_FILE_NAME} opened successfully`);
            objMetadata = JSON.parse(data);

            let counter = 0;
            let keys = Object.keys(recordObj);

            logger.log(logPath, logger.debug.INFO, `Objects to insert :: ${keys}`);
            console.log(order);
            for(let i = 0; i < order.length; i++) {
                let currObject = recordObj[order[i]];
            //for (let i = 0; i < keys.length; i++) {
                logger.log(logPath, logger.debug.INFO, `Inserting records asynchronously for ${keys[i]} :: ${currObject.length} records`);
                insertRecords(currObject, order[i]).then(() => {
                    logger.log(logPath, logger.debug.INFO, `Successfully inserted ${order[i]} records`);
                    if (counter === order.length - 1) {
                        logger.log(logPath, logger.debug.INFO, `ID Map :: ${idMap.toString()}`);
                        console.log("ID Map:");
                        console.dir(idMap);

                        updateIds();

                        let newKeys = Object.keys(recordObj);
                        counter = 0;
                        for (let j = 0; j < newKeys.length; j++) {
                            updateRecords(recordObj[newKeys[j]], newKeys[j]).then(() => {
                                if (counter === newKeys.length - 1) {
                                    logger.log(logPath, logger.debug.INFO, "Operation complete. Closing connection...");
                                    conn.logout((err) => {
                                        if (err) {
                                            logger.log(logPath, logger.debug.ERROR, `Error logging out :: ${err}`);
                                        } else {
                                            logger.log(logPath, logger.debug.INFO, "Successfully closed the connection to Salesforce");
                                            logger.flush(logPath);
                                        }
                                    });
                                }
                                counter++;
                            }).catch((err) => {
                                console.log("Error updating records. See logs for details");
                                logger.log(logPath, logger.debug.ERROR, `Error updating ${newKeys[i]} records :: ${err}`);
                                logger.flush(logPath);
                            });
                        }
                    }
                    counter++;
                }).catch((err) => {
                    console.log("Error inserting records. See logs for details");
                    logger.log(logPath, logger.debug.ERROR, `Error inserting ${keys[i]} records :: ${err}`);
                    logger.flush(logPath);
                });
            }
        }).catch((err) => {
            logger.log(logPath, logger.debug.ERROR, `Error in execution :: ${err}`);
            console.log("Error in execution. See logs for details");
            logger.flush(logPath);
        });
});

function updateIds() {
    let keys = Object.keys(recordObj);
    for (let i = 0; i < keys.length; i++) {
        let currentObj = keys[i];
        logger.log(logPath, logger.debug.INFO, `Updating Ids for ${currentObj}`);
        let metadata = objMetadata[currentObj];
        for (let j = 0; j < recordObj[currentObj].length; j++) {
            for (let k = 0; k < metadata.fields.length; k++) {
                if (metadata.fields[k].referenceTo.length > 0 && idMap[recordObj[currentObj][j][metadata.fields[k].name]]) {
                    logger.log(logPath, logger.debug.INFO, `Updating reference field ${currentObj}.${metadata.fields[k].name}`);
                    recordObj[currentObj][j][metadata.fields[k].name] = idMap[recordObj[currentObj][j][metadata.fields[k].name]];
                }
            }
        }
    }
}

function insertRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        console.log(`Inserting ${objectName}`);
        //console.log(records);
        conn.sobject(objectName).create(records, { allowRecursive: true }, (err, rets) => {
            if (err) reject(err);

            console.log(rets.length);
            console.log(objectName);
            rets.forEach((element => {
                console.dir(element);
            }));
            for (let i = 0; i < rets.length; i++) {
                idMap[records[i].Id] = rets[i].id;
                recordObj[objectName][i].Id = rets[i].id;
            }
            resolve();
        });
    });
}

function updateRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        console.log(`Updating ${objectName}`);
        //console.log(records);
        conn.sobject(objectName).update(records, { allowRecursive: true }, (err, ret) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/*
function syncRecordTypes() {
    return new Promise((resolve, reject) => {
        let keys = Object.keys(recordObj);
        let recordTypeIds = [];
        for (let i = 0; i < keys.length; i++) {
            for (let j = 0; j < recordObj[keys[i]].length; j++) {
                if (recordObj[keys[i]][j]["RecordTypeId"] && recordTypeIds.indexOf(recordObj[keys[i]][j]["RecordTypeId"]) === -1) {
                    recordTypeIds.push("'" + recordObj[keys[i]][j]["RecordTypeId"] + "'");
                }
            }
        }

        if (recordTypeIds.length > 0) {
            let queryString = "SELECT ID, Name FROM RecordType WHERE ID IN (" + recordTypeIds.join(",") + ")";

            console.log(queryString);

            let lOptions = {
                loginUrl: process.env.SF_SOURCE_ORG_URL
            }
            let sourceOrgConn = new jsforce.Connection(lOptions);

            sourceOrgConn.login(process.env.PROD_USER, process.env.PROD_PASS, (err, userInfo) => {
                if (err) reject(err);

                console.log(sourceOrgConn.instanceUrl);

                let recordTypeIdMap = {};
                utilities.query(sourceOrgConn, queryString).then((records) => {
                    sourceOrgConn.logout((err) => console.log("Logged out of source org :: " + err));

                    if (records.length === 0) {
                        reject("No record types found in source org");
                    }

                    for (let i = 0; i < records.length; i++) {
                        recordTypeIdMap[records[i].Name] = records[i].Id;
                    }

                    let queryString = "SELECT ID, Name FROM RecordType WHERE Name IN (" + Object.keys(recordTypeIdMap).map(x => "'" + x + "'").join(",") + ")";
                    console.log(queryString);

                    return utilities.query(conn, queryString);
                }).then((recordTypes) => {
                    let recTypeMap = {};
                    for (let i = 0; i < recordTypes.length; i++) {
                        recTypeMap[recordTypeIdMap[recordTypes[i].Name]] = recordTypes[i].Id;
                    }

                    let keys = Object.keys(recordObj);
                    for (let i = 0; i < keys.length; i++) {
                        for (let j = 0; j < recordObj[keys[i]].length; j++) {

                        }
                    }

                    resolve(recTypeMap);
                }).catch((err) => {
                    reject(err);
                });
            });
        } else {
            resolve();
        }
    });
}
*/
