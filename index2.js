"use strict";

const jsforce = require("jsforce");
const fs = require("fs");
const permittedObjects = require('./permittedObjects.js');

require('dotenv').config();

console.log("ENV vars " + process.env.SF_USERNAME);
console.log("ENV vars " + process.env.SF_LOGIN_URL);
console.log("ENV vars " + process.env.SF_PASSWORD);

// Establish a connection to Salesforce
var loginOptions = {
    loginUrl: process.env.SF_LOGIN_URL
};
let conn = new jsforce.Connection(loginOptions);

let recordObj = {};

let objMetadata = {};

let continueRecurse = true;

console.log("Logging into Salesforce...");
conn.login(process.env.SF_USERNAME, process.env.SF_PASSWORD, function (err, userInfo) {
    let currentObj = process.argv[2];
    let limit = process.argv[3];
    if (!currentObj || !limit)
        throw "Object and limit are required";
    console.log("Starting DFS");
    startDFS(currentObj, limit);
});

function startDFS(currentObj, limit) {
    console.log("In startDFS");
    getObjectMetadata(currentObj).then((metadata) => {
        let queryString = "SELECT ";
        let fields = [];
        metadata.fields.forEach((field) => {
            if (field.updateable || field.name.includes("__c") || field.name === "Id")
                fields.push(field.name);
        });
        queryString += fields.join(",");

        queryString += " FROM " + currentObj + " LIMIT ";
        queryString += limit;

        let records = [];
        conn.query(queryString).on("record", (record) => {
            records.push(record);
        }).on("end", () => {
            continueRecurse = true;
            recordObj[currentObj] = [];
            records.forEach((record) => {
                recordObj[currentObj].push(record);
            });

            metadata.childRelationships.forEach((rel) => {
                if (permittedObjects.indexOf(rel.childSObject) !== -1)
                    getRecordsDFS(rel.childSObject, currentObj);
            });

            metadata.fields.forEach((field) => {
                if (field.referenceTo.length > 0) {
                    field.referenceTo.forEach((ref) => {
                        if (permittedObjects.indexOf(ref) !== -1)
                            getRecordsDFS(ref, currentObj);
                    });
                }
            });
        }).on("error", (err) => {
            console.log("Error retrieving initial records");
        }).run({ autoFetch: true });
    }).catch((err) => {
        console.log("Error retrieving initial object metadata " + currentObj + " " + err);
    });

}

function getRecordsDFS(currentObj, parentObj) {
    // Grab current object metadata
    getObjectMetadata(currentObj).then((metadata) => {
        let currentObjMetadata = metadata;
        let newParentIds = [];

        getChildRelationshipRecords(currentObj, currentObjMetadata, parentObj).then(() => {
            console.log("Back from getChildRelationships");
            getLookupRecords(currentObj, currentObjMetadata, parentObj).then(() => {
                console.log("Back from getLookupObjects");
                fs.writeFile(
                    "recordObject.json",
                    JSON.stringify(recordObj),
                    function (err) {
                        if (err) console.log("Error writing file :: " + err);
                    }
                );
                if (continueRecurse) {
                    currentObjMetadata.childRelationships.forEach((rel) => {
                        if (permittedObjects.indexOf(rel.childSObject) !== -1)
                            getRecordsDFS(rel.childSObject, currentObj);
                    });

                    currentObjMetadata.fields.forEach((field) => {
                        if (field.referenceTo.length > 0) {
                            field.referenceTo.forEach((ref) => {
                                getRecordsDFS(ref, currentObj);
                            });
                        }
                    });
                }
            }).catch((err) => {
                console.log("Error getting lookup records :: " + err);
            })
        }).catch((err) => {
            console.log("Error getting child relationship records :: " + err);
        });
    }).catch((err) => {
        console.log("Error getting current object metadata :: " + err);
    });

}

function getChildRelationshipRecords(currentObj, currentObjMetadata, parentObj) {
    return new Promise((resolve, reject) => {
        let counter = 0;
        let numObjects = 0;
        for (let i = 0; i < currentObjMetadata.childRelationships.length; i++) {
            let rel = currentObjMetadata.childRelationships[i];
            if (rel.childSObject === parentObj) {
                numObjects++;
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord[rel.field]);
                });

                // Need to grab the records based on Id In parentObj[rel.field]
                fetchRecords(currentObj, currentObjMetadata, "Id", parentRelIds).then((records) => {
                    if (records.length > 0) {
                        if (recordObj[currentObj]) {
                            records.forEach((record) => {
                                // Add the records to the global record object if they do not exist there
                                if (recordObj[currentObj].indexOf(record) === -1) {
                                    recordObj[currentObj].push(record);
                                    continueRecurse = true;
                                } else {
                                    continueRecurse = false;
                                }
                            });
                        } else {
                            continueRecurse = true;
                            recordObj[currentObj] = [];
                            records.forEach((record) => {
                                recordObj[currentObj].push(record);
                            });
                        }
                    }


                    if (counter === numObjects - 1) {
                        resolve();
                    }
                    counter++;
                }).catch((err) => {
                    if (err !== "No ids to query with")
                        reject(err);
                });
            }
        }
    });
}

function getLookupRecords(currentObj, currentObjMetadata, parentObj) {
    console.log("In getLookupRecords");
    return new Promise((resolve, reject) => {
        let counter = 0;
        let numObjects = 0;
        for (let i = 0; i < currentObjMetadata.fields.length; i++) {
            let field = currentObjMetadata.fields[i];
            if (field.referenceTo.length > 0 && field.referenceTo.includes(parentObj)) {
                numObjects++;
                console.log("Parent Records :: " + recordObj[parentObj].length);
                // Need to grab the records based on field.name In ParentIds
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord["Id"]);
                });

                fetchRecords(currentObj, currentObjMetadata, field.name, parentRelIds).then((records) => {
                    if (recordObj[currentObj]) {
                        records.forEach((record) => {
                            // Add the records to the global record object if they do not exist there
                            if (recordObj[currentObj].indexOf(record) === -1) {
                                recordObj[currentObj].push(record);
                                continueRecurse = true;
                            } else {
                                continueRecurse = false;
                            }
                        });
                    } else {
                        continueRecurse = true;
                        recordObj[currentObj] = [];
                        records.forEach((record) => {
                            recordObj[currentObj].push(record);
                        });
                    }

                    if (counter === numObjects - 1) {
                        resolve();
                    }
                    counter++;

                    console.log("Counter :: " + counter);
                    console.log("Rel Length :: " + numObjects);
                }).catch((err) => {
                    if (err !== "No ids to query with")
                        reject(err);
                });
            }
        }

        resolve();
    });
}

function getObjectMetadata(currentObj) {
    return new Promise((resolve, reject) => {
        if (objMetadata[currentObj]) {
            resolve(objMetadata[currentObj]);
        } else {
            conn.sobject(currentObj).describe((err, metadata) => {
                if (err) reject(err);

                objMetadata[currentObj] = metadata;
                resolve(metadata);
            });
        }
    });
}

function fetchRecords(currentObj, metadata, relField, recIds) {
    return new Promise((resolve, reject) => {
        let queryString = "SELECT ";
        let fields = [];
        metadata.fields.forEach((field) => {
            if (field.updateable || field.name.includes("__c") || field.name === "Id")
                fields.push(field.name);
        });
        queryString += fields.join(",");

        queryString += " FROM " + currentObj + " WHERE " + relField + " IN (";
        let ids = [];
        recIds.forEach((id) => {
            if (id)
                ids.push("'" + id + "'");
        });

        if (ids.length === 0)
            reject("No ids to query with");

        queryString += ids.join(",");
        queryString += ')';

        let records = [];
        conn.query(queryString).on("record", (record) => {
            records.push(record);
        }).on("end", () => {
            resolve(records);
        }).on("error", (err) => {
            reject(err);
        }).run({ autoFetch: true });
    });
}