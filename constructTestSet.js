"use strict";

const jsforce = require("jsforce");
const Tree = require("./includes/Tree.js");
const util = require("./includes/utilities.js");
const logger = require("./includes/logger.js");

require('dotenv').config();

let objectMetadataMap = {};
let loginOptions = { loginUrl: process.env.DEV_SF_SOURCE_ORG_URL };
let conn = new jsforce.Connection(loginOptions);
let recordObject = {};

let permittedObjects = null;
let explorableObjects = null;

let userId = "";

const logPath = "./logs/constructTestSet.log";

conn.login(process.env.DEV_SF_SOURCE_ORG_USER, process.env.DEV_SF_SOURCE_ORG_PASS + process.env.DEV_SF_SOURCE_ORG_TOKEN, (err, userInfo) => {
    if (err) logger.log("error", err);

    userId = userInfo.id;

    logger.log(logPath, logger.debug.INFO, "Logged into " + conn.instanceUrl + " as " + userInfo.id);
    util.readFile("./includes/objectRes.json")
        .then((data) => {
            let d = JSON.parse(data);
            permittedObjects = d["permittedObjects"];
            explorableObjects = d["explorableObjects"];
            return buildMetadataMap();
        }).then(() => {
            let keys = Object.keys(objectMetadataMap);
            for (let i = 0; i < keys.length; i++) {
                if (!objectMetadataMap[keys[i]]) {
                    delete objectMetadataMap[keys[i]];
                }
            }
            logger.log(logPath, logger.debug.INFO, "Finished building metadata map");
            logger.log(logPath, logger.debug.INFO, "Object metadata map keys :: " + Object.keys(objectMetadataMap));
            return buildDataTree("Loan__c");
        }).then((res) => {
            let tree = res;
            tree.print();
            logger.log(logPath, logger.debug.INFO, "Tree :: " + tree.print());
            logger.log(logPath, logger.debug.INFO, JSON.stringify(tree, (key, value) => {
                if (key === "parent") {
                    return undefined;
                }
                return value;
            }));
            util.writeFile("./Data/tree.json", JSON.stringify(tree, (key, value) => {
                if (key === "parent") {
                    return undefined;
                }
                return value;
            })).catch(err => logger.log("error", err));
            return buildRecordObject(tree.root, [], tree);
        }).then(() => {
            logger.log(logPath, logger.debug.INFO, "Finished building record object :: Size " + Object.keys(recordObject).length);

            let keys = Object.keys(recordObject);
            for (let i = 0; i < keys.length; i++) {
                if (recordObject[keys[i]].length === 0) {
                    console.log(`Deleting ${keys[i]}`);
                    delete recordObject[keys[i]];
                }
            }

            util.createDir("./" + process.env.DATA_FOLDER_NAME);
            util.writeFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.DATA_FILE_NAME, JSON.stringify(recordObject)).catch(err => logger.log("error", err));
            util.writeFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.METADATA_FILE_NAME, JSON.stringify(objectMetadataMap)).catch(err => logger.log("error", err));
        }).catch((err) => {
            logger.log(logPath, logger.debug.ERROR, err);
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
                    logger.log(logPath, logger.debug.ERROR, err);
                });
        }
    });
}

function buildDataTree(rootObject) {
    return new Promise((resolve, reject) => {
        try {
            let tree = new Tree(rootObject);
            tree.traverseBF((currentNode) => {
                logger.log(logPath, logger.debug.INFO, "Current Node :: " + currentNode.objectName);
                let metadata = objectMetadataMap[currentNode.objectName];

                if (explorableObjects.indexOf(currentNode.objectName) !== -1) {
                    for (let i = 0; i < metadata.fields.length; i++) {
                        if (metadata.fields[i].referenceTo.length > 0) {
                            for (let j = 0; j < metadata.fields[i].referenceTo.length; j++) {
                                let currObject = metadata.fields[i].referenceTo[j];
                                if (permittedObjects.indexOf(currObject) !== -1) {
                                    let node = tree.contains(currObject);
                                    if (node) {
                                        node.addRelatedField(metadata.fields[i].name, "childRel");
                                    } else {
                                        let newNode = tree.add(currObject, currentNode.objectName);
                                        newNode.addRelatedField(metadata.fields[i].name, "childRel");
                                    }
                                }
                            }
                        }
                    }

                    for (let i = 0; i < metadata.childRelationships.length; i++) {
                        let currObject = metadata.childRelationships[i];
                        if (permittedObjects.indexOf(currObject.childSObject) !== -1) {
                            let node = tree.contains(currObject.childSObject);
                            if (node) {
                                node.addRelatedField(metadata.childRelationships[i].field, "lookup");
                            } else {
                                let newNode = tree.add(currObject.childSObject, currentNode.objectName);
                                newNode.addRelatedField(metadata.childRelationships[i].field, "lookup");
                            }
                        }
                    }
                }
            });
            resolve(tree);
        } catch (err) {
            logger.log("error", err);
            reject(err);
        }
    });
}

function doQuery(currentNode, tree) {
    return new Promise((resolve, reject) => {
        logger.log("info", "Doing query for :: " + currentNode.objectName);
        let queryString = null;

        if (currentNode === tree.root) {
            queryString = buildQueryString(currentNode, 1);
        } else {
            queryString = buildQueryString(currentNode, null);
        }
        logger.log(logPath, logger.debug.DEBUG, queryString);

        if (queryString) {
            query(queryString).then((records) => {
                for(let i = 0; i < records.length; i++) {
                    if(records[i].OwnerId)
                        records[i].OwnerId = userId;
                }

                recordObject[currentNode.objectName] = records;
                resolve();
            }).catch((err) => {
                logger.log("error", err);
            });
        } else {
            resolve();
        }
    });
}

function buildRecordObject(currentNode, queue, tree) {
    return doQuery(currentNode, tree).then(() => {
        for (let i = 0, length = currentNode.children.length; i < length; i++) {
            queue.push(currentNode.children[i]);
        }
        currentNode = queue.shift();

        if (currentNode) {
            return buildRecordObject(currentNode, queue, tree);
        } else {
            return;
        }
    });
}

function buildQueryString(currentNode, limit) {
    let metadata = objectMetadataMap[currentNode.objectName];

    let queryString = null;

    if (metadata) {
        if (limit) {
            queryString = "SELECT ";
            let fields = [];
            metadata.fields.forEach((field) => {
                // To avoid grabbing readonly fields
                if (field.createable /*|| field.name.includes("__c")*/ || field.name === "Id")
                    fields.push(field.name);
            });
            queryString += fields.join(",");

            queryString += " FROM " + currentNode.objectName + " WHERE Id in ('a000Z00000ibcyVQAQ', 'a000Z00000ibcy5QAA')  ";
            //queryString += limit;
        } else {
            let relField = null;
            let parents = recordObject[currentNode.parent.objectName];
            let conditionals = [];

            if (parents) {
                currentNode.relatedFields.forEach((relatedField) => {
                    let recIds = [];
                    let conditional = "";

                    if (relatedField.relationshipType === 'lookup') {
                        conditional += relatedField.fieldName + " IN (";

                        for (let i = 0; i < parents.length; i++) {
                            recIds.push("'" + parents[i].Id + "'");
                        }


                    } else {
                        conditional += "Id IN (";

                        for (let i = 0; i < parents.length; i++) {
                            if (parents[i][relatedField.fieldName]) {
                                recIds.push("'" + parents[i][relatedField.fieldName] + "'");
                            }
                        }
                    }

                    if (recIds.length > 0) {
                        conditional += recIds.join(",") + ")";
                        conditionals.push(conditional);
                    }
                });
            }

            if (conditionals.length > 0) {
                queryString = "SELECT ";
                let fields = [];
                metadata.fields.forEach((field) => {
                    if (field.createable /*|| field.name.includes("__c")*/ || field.name === "Id")
                        fields.push(field.name);
                });
                queryString += fields.join(",");

                queryString += " FROM " + currentNode.objectName + " WHERE ";
                queryString += conditionals.join(" OR ");
            }
        }
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

