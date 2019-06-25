"use strict";

const jsforce = require("jsforce");
const Tree = require("./Tree.js");
const permittedObjects = require("./permittedObjects.js");
const util = require("./utilities.js");

require('dotenv').config();

let objectMetadataMap = {};
let loginOptions = { loginUrl: process.env.SF_SOURCE_ORG_URL };
let conn = new jsforce.Connection(loginOptions);
let recordObject = {};

conn.login(process.env.SF_SOURCE_ORG_USER, process.env.SF_SOURCE_ORG_PASS, (err, userInfo) => {
    if (err) console.log(err);

    buildMetadataMap()
        .then(() => {
            let keys = Object.keys(objectMetadataMap);
            for (let i = 0; i < keys.length; i++) {
                if (!objectMetadataMap[keys[i]]) {
                    delete objectMetadataMap[keys[i]];
                }
            }
            console.log("Finished building metadata map");
            console.log("Keys :: " + Object.keys(objectMetadataMap));
            return buildDataTree("Loan__c");
        }).then((res) => {
            let tree = res;
            tree.print();
            console.log("Done printing tree");

            return buildRecordObject(tree);
        }).then(() => {
            util.writeFile("./Data/testData.json", JSON.stringify(recordObject)).catch(err => console.log(err));
        }).catch((err) => {
            console.log(err);
        });
});

function buildMetadataMap() {
    return new Promise((resolve, reject) => {
        let count = 0;
        for (let i = 0; i < permittedObjects.length; i++) {
            getObjectMetadata(permittedObjects[i])
                .then((metadata) => {
                    if (count === permittedObjects.length - 1)
                        resolve();

                    count++;
                }).catch((err) => {
                    count++;
                });
        }
    });
}

function buildDataTree(rootObject) {
    return new Promise((resolve, reject) => {
        try {
            let tree = new Tree(rootObject);
            tree.traverseBF((currentNode) => {
                console.log("Current Node :: " + currentNode.objectName);
                let metadata = objectMetadataMap[currentNode.objectName];

                for (let i = 0; i < metadata.fields.length; i++) {
                    if (metadata.fields[i].referenceTo.length > 0) {
                        for (let j = 0; j < metadata.fields[i].referenceTo.length; j++) {
                            let currObject = metadata.fields[i].referenceTo[j];
                            if (permittedObjects.indexOf(currObject) !== -1 && !tree.contains(currObject)) {
                                tree.add(currObject, currentNode.objectName);
                            }
                        }
                    }
                }

                // May need to do this for other objects too like Terms
                if (currentNode === tree.root) {
                    for (let i = 0; i < metadata.childRelationships.length; i++) {
                        let currObject = metadata.childRelationships[i];
                        if (permittedObjects.indexOf(currObject.childSObject) !== -1 && !tree.contains(currObject.childSObject)) {
                            tree.add(currObject.childSObject, currentNode.objectName);
                        }
                    }
                }
            });
            console.log("Continuing");
            resolve(tree);
        } catch (err) {
            reject(err);
        }
    });
}

function buildRecordObject(tree) {
    return new Promise((resolve, reject) => {
        tree.traverseBF((currentNode) => {
            let queryString = null;

            if (currentNode === tree.root) {
                queryString = buildQueryString(currentNode.objectName);
            } else {
                // Handle all nodes that are not root
            }

            if (queryString) {
                query(queryString).then((records) => {
                    recordObject[currentNode.objectName] = records;
                }).catch((err) => {
                    // Reject?
                });
            }
        });
    });
}

function buildQueryString(objectName) {
    let metadata = objectMetadataMap[objectName];

    let queryString = null;

    if (metadata) {
        queryString = "SELECT ";
        let fields = [];
        metadata.fields.forEach((field) => {
            // To avoid grabbing readonly fields
            if (field.updateable || field.name.includes("__c") || field.name === "Id")
                fields.push(field.name);
        });
        queryString += fields.join(",");

        queryString += " FROM " + currentObj + " LIMIT ";
        queryString += limit;
    }

    return queryString;
}

function query(queryString) {
    return new Promise((resolve, reject) => {
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

function getObjectMetadata(currentObj) {
    return new Promise((resolve, reject) => {
        if (currentObj in objectMetadataMap) {
            resolve(objectMetadataMap[currentObj]);
        } else {
            conn.sobject(currentObj).describe((err, metadata) => {
                if (err) reject(err);

                objectMetadataMap[currentObj] = metadata;
                resolve(metadata);
            });
        }
    });
}

