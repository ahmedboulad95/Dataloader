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
let continueRecurse = false;

// Log in to Salesforce
conn.login(process.env.SF_DEV_USER, process.env.SF_DEV_PASS, function (err, userInfo) {
    let currentObj = process.argv[2];
    let limit = process.argv[3];

    if (!currentObj || !limit)
        throw "Object and limit are required";

    startDFS(currentObj, limit).then(() => {
        console.log("Returned from startDFS");
        return getRecordsDFS();
    }).then(() => {
        fs.writeFile(
            "recordObject.json",
            JSON.stringify(recordObj),
            function (err) {
                if (err) console.log("Error writing file :: " + err);
            }
        );

        
    }).catch((err) => {
        console.log(err);
    });
});

// Grabs the records for the initial object and then starts the DFS algorithm to get all related records
// See permittedObjects.js for a list of objects that are pulled
function startDFS(currentObj, limit) {
    return new Promise((resolve, reject) => {
        // Get the metadata from SF for the initial object
        getObjectMetadata(currentObj).then((metadata) => {
            // Build the query for the initial object
            let queryString = "SELECT ";
            let fields = [];
            metadata.fields.forEach((field) => {
                // To avoid grabbing readonly fields
                if (field.updateable || field.name.includes("__c") || field.name === "Id")
                    fields.push(field.name);
            });
            queryString += fields.join(",");

            queryString += " FROM " + currentObj + " LIMIT ";
            queryString += limit;

            let records = [];

            // Query for records from SF
            conn.query(queryString).on("record", (record) => {
                records.push(record);
            }).on("end", () => {
                // Add the retrieved records to the global records object
                recordObj[currentObj] = [];
                records.forEach((record) => {
                    recordObj[currentObj].push(record);
                });

                // Add each relationship to the stack for further exploration
                // Child relationship: OtherObject -> CurrentObject
                metadata.childRelationships.forEach((rel) => {
                    if (permittedObjects.indexOf(rel.childSObject) !== -1) {
                        stack.push({ currentObj: rel.childSObject, parentObj: currentObj });
                    }
                });

                // Add each lookup field to the stack for further exploration
                // Lookup: CurrentObject -> OtherObject
                metadata.fields.forEach((field) => {
                    if (field.referenceTo.length > 0) {
                        field.referenceTo.forEach((ref) => {
                            if (permittedObjects.indexOf(ref) !== -1) {
                                stack.push({ currentObj: ref, parentObj: currentObj });
                            }
                        });
                    }
                });

                // Start DFS
                console.log("Resolving");
                resolve();
            }).on("error", (err) => {
                console.log("Error querying for initial object records");
                reject(err);
            }).run({ autoFetch: true });
        }).catch((err) => {
            console.log("Error getting initial object metadata");
            reject(err);
        });
    })
}

// Builds a full set of data with all relationships through an implementation of DFS
function getRecordsDFS() {

    console.log('\n');
    console.log("getRecordsDFS : Stack :: " + JSON.stringify(stack));
    let nextItem = stack.pop();
    console.log(nextItem);
    console.log('\n');

    if (!nextItem) {
        console.log("Done with dfs");
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        // Loop until stack is empty
        let currentObj = nextItem.currentObj;
        let parentObj = nextItem.parentObj;

        // Grab the metadata for the current object from SF
        getObjectMetadata(currentObj).then((metadata) => {
            let currentObjMetadata = metadata;

            // Grab current object records through: Parent -> Current relationship
            getChildRelationshipRecords(currentObj, currentObjMetadata, parentObj).then(() => {
                console.log("Got child relationships")

                // Grab current object records through: Current -> Parent relationship
                getLookupRecords(currentObj, currentObjMetadata, parentObj).then(() => {
                    console.log("Got lookup records");



                    // continueRecurse is set to true when new records are added to recordObject
                    // If no new records are added, no need to explore those relationships
                    if (continueRecurse) {
                        // Add all relationships (Parent -> Current) to the stack for further exploration
                        currentObjMetadata.childRelationships.forEach((rel) => {
                            if (permittedObjects.indexOf(rel.childSObject) !== -1) {
                                let newItem = { currentObj: rel.childSObject, parentObj: currentObj };
                                if (stack.indexOf(newItem) === -1)
                                    stack.push(newItem);
                            }
                        });

                        // Add all lookups (Current -> Parent) to the stack for further exploration
                        currentObjMetadata.fields.forEach((field) => {
                            if (field.referenceTo.length > 0) {
                                // Lookup could reference multiple objects, so need to add all of them
                                field.referenceTo.forEach((ref) => {
                                    if (permittedObjects.indexOf(ref) !== -1) {
                                        let newItem = { currentObj: ref, parentObj: currentObj };
                                        if (stack.indexOf(newItem) === -1)
                                            stack.push(newItem);
                                    }
                                });
                            }
                        });
                    }
                    // Reset continueRecurse to false, so other methods can change it if new records are added
                    continueRecurse = false;
                    resolve(getRecordsDFS());
                }).catch((err) => {
                    console.log("Error getting lookup records");
                    reject(err);
                })
            }).catch((err) => {
                console.log("Error getting child relationships");
                reject(err);
            });
        }).catch((err) => {
            console.log("Error getting object metadata");
            reject(err);
        });
    });
}

// Adds all records to object based on Parent -> Current relationship
function getChildRelationshipRecords(currentObj, currentObjMetadata, parentObj) {
    return new Promise((resolve, reject) => {
        // Used to determine when to resolve
        let counter = 0;
        let numObjects = 0;

        // List of all relationships. Used to avoid getting stuck in this method if there are no relationship fields
        let childRels = [];

        // Add all relationshps to list to be processed
        for (let i = 0; i < currentObjMetadata.childRelationships.length; i++) {
            let rel = currentObjMetadata.childRelationships[i];

            // Only add relationships from the parent object
            if (rel.childSObject === parentObj) {
                childRels.push(rel);
            }
        }

        // This ensures we do not get stuck in this method
        // If there are relationships, process them, otherwise return
        if (childRels.length > 0) {
            // Grab the records for each relationship field
            // This really only applies if there are multiple lookups to the current object on the parent object
            for (let i = 0; i < childRels.length; i++) {
                numObjects++;
                let rel = childRels[i];

                // Grab the values from the parent records for the relationship field
                // To be used in the query
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord[rel.field]);
                });

                // Need to grab the records based on Id In parentObj[rel.field] since this is a Parent -> Current realtionship
                fetchRecords(currentObj, currentObjMetadata, "Id", parentRelIds).then((records) => {
                    // Process the returned records if there are any
                    if (records && records.length > 0) {
                        // If recordObject already has records for the current object, need to avoid adding dups
                        if (recordObj[currentObj]) {
                            records.forEach((record) => {
                                // Check for duplicate
                                if (!findObjectInList(recordObj[currentObj], record)) {
                                    console.log("Record not in object yet. Adding now");
                                    recordObj[currentObj].push(record);
                                    continueRecurse = true;
                                }
                            });
                        } else {
                            // Add all records if recordObject does not yet contain the current object
                            continueRecurse = true;
                            recordObj[currentObj] = records;
                        }
                    }

                    // If on the last relationship, return to the caller
                    if (counter === numObjects - 1) {
                        resolve();
                    }
                    counter++;
                }).catch((err) => {
                    reject(err);
                });
            }
        } else {
            resolve();
        }
    });
}

// Adds all records to object based on Current -> Parent relationship
function getLookupRecords(currentObj, currentObjMetadata, parentObj) {
    return new Promise((resolve, reject) => {
        let counter = 0;
        let numObjects = 0;
        let childRels = [];

        // Store all of the lookups in a list. This will keep us from getting stuck in this method
        for (let i = 0; i < currentObjMetadata.fields.length; i++) {
            let field = currentObjMetadata.fields[i];
            if (field.referenceTo.length > 0 && field.referenceTo.includes(parentObj)) {
                childRels.push(field);
            }
        }

        // If there are lookups, process each one, otherwise return
        if (childRels.length > 0) {
            // Grab the records for each lookup
            for (let i = 0; i < childRels.length; i++) {
                numObjects++;
                let field = childRels[i];
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord["Id"]);
                });

                // Need to grab the records based on lookupName in parentIds
                fetchRecords(currentObj, currentObjMetadata, field.name, parentRelIds).then((records) => {
                    if (records && records.length > 0) {
                        // If the current object is already in recordObject, check for duplicates before adding
                        if (recordObj[currentObj]) {
                            records.forEach((record) => {
                                // Check if records is already in recordObject
                                if (!findObjectInList(recordObj[currentObj], record)) {
                                    recordObj[currentObj].push(record);
                                    continueRecurse = true;
                                }
                            });
                        } else {
                            // Add the whole list of records if the object is not in recordObject yet
                            continueRecurse = true;
                            recordObj[currentObj] = records;
                        }
                    }

                    // If on the last lookup, return to caller
                    if (counter === numObjects - 1) {
                        resolve();
                    }
                    counter++;
                }).catch((err) => {
                    reject(err);
                });
            }
        } else {
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

// Build and execute query for the passed in object
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
            resolve();

        queryString += ids.join(",");
        queryString += ')';

        console.log("Query :: " + queryString);
        let records = [];
        conn.query(queryString).on("record", (record) => {
            records.push(record);
        }).on("end", () => {
            console.log("Records Size :: " + records.length);
            resolve(records);
        }).on("error", (err) => {
            reject(err);
        }).run({ autoFetch: true });
    });
}

// Determines if a record is already in recordObject. Returns true if it is, false if not
function findObjectInList(arr, obj) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].Id === obj.Id) {
            return true;
        }
    }
    return false;
}

function insertRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        conn.sobject(objectName).create(records, { allowRecursive: true }, (err, ret) => {
            if (err) reject(err);
            else resolve(ret);
        });
    });
}

function updateRecords(records, objectName) {
    return new Promise((resolve, reject) => {
        conn.sobject(objectName).update(records, { allowRecursive: true }, (err, ret) => {
            if (err) reject(err);
            else resolve(ret);
        });
    });
}