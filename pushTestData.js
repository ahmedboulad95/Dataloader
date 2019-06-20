"use strict";

const jsforce = require("jsforce");
const fs = require("fs");
const utilities = require("./utilities.js");

require('dotenv').config();

// Establish a connection to Salesforce
var loginOptions = {
    loginUrl: process.env.SF_DEST_ORG_URL
};

let conn = new jsforce.Connection(loginOptions);
let recordObj = {};
let objMetadata = {};
let idMap = {};

// Log in to Salesforce
conn.login(process.env.SF_DEST_ORG_USER, process.env.SF_DEST_ORG_PASS, function (err, userInfo) {
    if (err) throw err;

    utilities.readFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.DATA_FILE_NAME)
        .then((data) => {
            recordObj = JSON.parse(data);
            return utilities.readFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.METADATA_FILE_NAME);
        }).then((data) => {
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