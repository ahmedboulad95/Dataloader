"use strict";

const jsforce = require("jsforce");
const utilities = require("./utilities.js");

require('dotenv').config();

// Establish a connection to Salesforce
var loginOptions = {
    loginUrl: process.env.SF_DEV_LOGIN_URL
};

let conn = new jsforce.Connection(loginOptions);
let recordObj = {};
let objMetadata = {};
let idMap = {};

// Log in to Salesforce
conn.login(process.env.SF_DEV_USERNAME, process.env.SF_DEV_PASSWORD, function (err, userInfo) {
    if (err) throw err;

    utilities.readFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.DATA_FILE_NAME)
        .then((data) => {
            if (!data) {
                throw "Data file not found or empty";
            }
            recordObj = JSON.parse(data);
            return utilities.readFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.METADATA_FILE_NAME);
        }).then((data) => {
            if (!data) {
                throw "Metadata file not found or empty";
            }

            objMetadata = JSON.parse(data);

            let counter = 0;
            let keys = Object.keys(recordObj);
            for (let i = 0; i < keys.length; i++) {
                insertRecords(recordObj[keys[i]], keys[i]).then(() => {
                    if (counter === keys.length - 1) {
                        console.dir(idMap);

                        updateIds();
                        console.log(JSON.stringify(recordObj))
                        let newKeys = Object.keys(recordObj);
                        counter = 0;
                        for (let j = 0; j < newKeys.length; j++) {
                            updateRecords(recordObj[newKeys[j]], newKeys[j]).then(() => {
                                if (counter === newKeys.length - 1) {
                                    conn.logout((err) => {
                                        if (err) console.log(err);
                                    });

                                    console.log("Operation complete");
                                }
                                counter++;
                            }).catch((err) => {
                                console.log(err);
                            });
                        }
                    }
                    counter++;
                }).catch((err) => {
                    console.log(err);
                });
            }
        }).catch((err) => {
            console.log(err);
        });
});

function insertBulk(records, objectName) {
    return new Promise((resolve, reject) => {
        let job = conn.bulk.createJob(objectName, "insert");
        let batch = job.createBatch();

        batch.execute(records);
        batch.on("error", (batchInfo) => {
            reject(batchInfo);
        });
        batch.on("queue", (batchInfo) => {
            batch.poll(1000, 120000);
        });
        batch.on("response", (rets) => {
            for (let i = 0; i < rets.length; i++) {
                idMap[records[i].Id] = rets[i].id;
                recordObj[objectName][i].Id = rets[i].id;
            }
            resolve();
        });
    });
}

function updateBulk(records, objectName) {
    return new Promise((resolve, reject) => {
        let job = conn.bulk.createJob(objectName, "update");
        let batch = job.createBatch();

        batch.execute(records);
        batch.on("error", (batchInfo) => {
            reject(batchInfo);
        });
        batch.on("queue", (batchInfo) => {
            batch.poll(1000, 120000);
        });
        batch.on("response", (rets) => {
            resolve();
        });
    });
}

function updateIds() {
    let keys = Object.keys(recordObj);
    for (let i = 0; i < keys.length; i++) {
        let currentObj = keys[i];
        console.log(currentObj);
        let metadata = objMetadata[currentObj];
        console.log("After getting metadata");
        for (let j = 0; j < recordObj[currentObj].length; j++) {
            console.log("Looping through records");
            for (let k = 0; k < metadata.fields.length; k++) {
                console.log("Looping through fields");
                console.log("Field :: " + metadata.fields[k].name);

                if (metadata.fields[k].referenceTo.length > 0 && idMap[recordObj[currentObj][j][metadata.fields[k].name]]) {

                    recordObj[currentObj][j][metadata.fields[k].name] = idMap[recordObj[currentObj][j][metadata.fields[k].name]];
                }
            }
        }
    }
}

function insertRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        conn.sobject(objectName).create(records, { allowRecursive: true }, (err, rets) => {
            if (err) reject(err);
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
