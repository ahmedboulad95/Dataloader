"use strict";

const jsforce = require("jsforce");
const fs = require("fs");
const permittedObjects = require('./permittedObjects.js');

require('dotenv').config();

// Establish a connection to Salesforce
var loginOptions = {
    loginUrl: process.env.SF_DEV_LOGIN
};

let conn = new jsforce.Connection(loginOptions);
let recordObj = {};
let objMetadata = {};
let stack = [];
let continueRecurse = true;

console.log("Logging into Salesforce...");
conn.login(process.env.SF_DEV_USER, process.env.SF_DEV_PASS, function (err, userInfo) {
    console.log("Instance :: " + conn.instanceUrl);
    let currentObj = process.argv[2];
    let limit = process.argv[3];
    if (!currentObj || !limit)
        throw "Object and limit are required";
    console.log("Starting DFS");
    startDFS(currentObj, limit);
});

function startDFS(currentObj, limit) {
    getObjectMetadata(currentObj).then((metadata) => {
        console.log("startDFS : Got object metadata for " + currentObj);
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
            console.log("startDFS : Retrieved all " + currentObj + " records");
            continueRecurse = true;
            recordObj[currentObj] = [];
            records.forEach((record) => {
                recordObj[currentObj].push(record);
            });

            console.log("startDFS : Starting getRecordsDFS");
            metadata.childRelationships.forEach((rel) => {
                if (permittedObjects.indexOf(rel.childSObject) !== -1) {
                    console.log("startDFS : childRelationship Related object + Current Object :: " + rel.childSObject + " " + currentObj);
                    //getRecordsDFS(rel.childSObject, currentObj);
                    stack.push({ currentObj: rel.childSObject, parentObj: currentObj });
                }
            });

            metadata.fields.forEach((field) => {
                if (field.referenceTo.length > 0) {
                    field.referenceTo.forEach((ref) => {
                        if (permittedObjects.indexOf(ref) !== -1) {
                            console.log("startDFS : lookup Related object + Current Object :: " + ref + " " + currentObj);
                            //getRecordsDFS(ref, currentObj);
                            stack.push({ currentObj: ref, parentObj: currentObj });
                        }
                    });
                }
            });

            //let nextItem = stack.pop();
            //console.log("startDFS : Next Item :: " + nextItem.currentObj + " " + nextItem.parentObj);
            getRecordsDFS();
        }).on("error", (err) => {
            console.log("Error retrieving initial records");
        }).run({ autoFetch: true });
    }).catch((err) => {
        console.log("Error retrieving initial object metadata " + currentObj + " " + err);
    });

}

function getRecordsDFS() {
    //while (stack.length > 0) {
    console.log("getRecordsDFS : Stack :: " + JSON.stringify(stack));
    let nextItem = stack.pop();

    // Grab current object metadata
    if (nextItem) {
        let currentObj = nextItem.currentObj;
        let parentObj = nextItem.parentObj;
        getObjectMetadata(currentObj).then((metadata) => {
            console.log("getRecordsDFS : Returned from getObjectMetadata");
            console.log("getRecordsDFS : Current Object :: " + currentObj);
            let currentObjMetadata = metadata;
            let newParentIds = [];

            getChildRelationshipRecords(currentObj, currentObjMetadata, parentObj).then(() => {
                console.log("getRecordsDFS : Back from getChildRelationships");
                getLookupRecords(currentObj, currentObjMetadata, parentObj).then(() => {
                    console.log("getRecordsDFS : Back from getLookupObjects");
                    fs.writeFile(
                        "recordObject.json",
                        JSON.stringify(recordObj),
                        function (err) {
                            if (err) console.log("Error writing file :: " + err);
                        }
                    );
                    if (continueRecurse) {
                        currentObjMetadata.childRelationships.forEach((rel) => {
                            if (permittedObjects.indexOf(rel.childSObject) !== -1) {
                                console.log("getRecordsDFS : Related object + Current Object :: " + rel.childSObject + " " + currentObj);
                                //getRecordsDFS(rel.childSObject, currentObj);
                                let newItem = { currentObj: rel.childSObject, parentObj: currentObj };
                                if (stack.indexOf(newItem) === -1)
                                    stack.push(newItem);
                            }

                        });

                        currentObjMetadata.fields.forEach((field) => {
                            if (field.referenceTo.length > 0) {
                                field.referenceTo.forEach((ref) => {
                                    if (permittedObjects.indexOf(ref) !== -1) {
                                        console.log("getRecordsDFS : Related object + Current Object :: " + ref + " " + currentObj);
                                        //getRecordsDFS(ref, currentObj);

                                        let newItem = { currentObj: ref, parentObj: currentObj };
                                        if (stack.indexOf(newItem) === -1)
                                            stack.push(newItem);
                                    }

                                });
                            }
                        });

                        /*let nextItem = stack.pop();*/

                    }
                    getRecordsDFS();
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
    //}

}

function getChildRelationshipRecords(currentObj, currentObjMetadata, parentObj) {
    console.log("getChildRelationshipRecords : In getChildRelationshipRecords");
    console.log("getChildRelationshipRecords : Current Object :: " + currentObj);
    console.log("getChildRelationshipRecords : Parent Object :: " + parentObj);
    return new Promise((resolve, reject) => {
        let counter = 0;
        let numObjects = 0;
        let childRels = [];
        for (let i = 0; i < currentObjMetadata.childRelationships.length; i++) {
            let rel = currentObjMetadata.childRelationships[i];
            console.log("getChildRelationshipRecords : In getChild RelationshipRecords :: " + rel.childSObject + " " + parentObj);
            if (rel.childSObject === parentObj) {
                childRels.push(rel);
            }
        }

        if (childRels.length > 0) {
            for (let i = 0; i < childRels.length; i++) {
                numObjects++;
                let rel = childRels[i];
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord[rel.field]);
                });

                // Need to grab the records based on Id In parentObj[rel.field]
                fetchRecords(currentObj, currentObjMetadata, "Id", parentRelIds).then((records) => {
                    console.log("getChildRelationshipRecords : Grabbed relationship records");
                    if (records.length > 0) {
                        if (recordObj[currentObj]) {
                            records.forEach((record) => {
                                // Add the records to the global record object if they do not exist there
                                console.log("getChildRels " + findObjectInList(recordObj[currentObj], record));
                                if (findObjectInList(recordObj[currentObj], record)) {
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
                        //continueRecurse
                        resolve();
                    }
                    counter++;
                }).catch((err) => {
                    if (err !== "No ids to query with")
                        reject(err);
                });
            }
        } else {
            continueRecurse = false;
            resolve();
        }
    });
}

function findObjectInList(arr, obj) {
    arr.forEach((element) => {
        if(element.Id === obj.Id)
        {
            console.log("Equal " + element.Id + " " + obj.Id);
            return true;
        }
    });
    return false;
}

function getLookupRecords(currentObj, currentObjMetadata, parentObj) {
    console.log("getLookupRecords : In getLookupRecords");
    console.log("getLookupRecords : Current Object :: " + currentObj);
    console.log("getLookupRecords : Parent Object :: " + parentObj);
    return new Promise((resolve, reject) => {
        let counter = 0;
        let numObjects = 0;
        let childRels = [];
        for (let i = 0; i < currentObjMetadata.fields.length; i++) {
            let field = currentObjMetadata.fields[i];
            console.log("getLookupRecords : In getLookupRecords :: " + field.referenceTo + " " + parentObj);
            if (field.referenceTo.length > 0 && field.referenceTo.includes(parentObj)) {
                childRels.push(field);
                console.log("getLookupRecords : Parent Records :: " + recordObj[parentObj].length);
                // Need to grab the records based on field.name In ParentIds
            }
        }

        if (childRels.length > 0) {
            for (let i = 0; i < childRels.length; i++) {
                numObjects++;
                let field = childRels[i];
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord["Id"]);
                });

                fetchRecords(currentObj, currentObjMetadata, field.name, parentRelIds).then((records) => {
                    console.log("getLookupRecords : Grabbed lookup records");
                    if (recordObj[currentObj]) {
                        records.forEach((record) => {
                            // Add the records to the global record object if they do not exist there
                            console.log("getLookups " + findObjectInList(recordObj[currentObj], record));
                            if (findObjectInList(recordObj[currentObj], record)) {
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

                    console.log("getLookupRecords : Counter :: " + counter);
                    console.log("getLookupRecords : Rel Length :: " + numObjects);
                }).catch((err) => {
                    if (err !== "No ids to query with")
                        reject(err);
                });
            }
        } else {
            continueRecurse = false;
            resolve();
        }
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

function insertRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        conn.sobject(objectName).create(records, { allowRecursive: true }, (err, ret) => {
            if(err) reject(err);
            else resolve(ret);
        });
    });
}

function updateRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        conn.sobject(objectName).update(records, { allowRecursive:true }, (err, ret) => {
            if(err) reject(err);
            else resolve(ret);
        });
    });
}