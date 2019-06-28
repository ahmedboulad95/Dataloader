"use strict";

const jsforce = require("jsforce");
const Tree = require("./Tree.js");
const permittedObjects = require("./permittedObjects.js").permittedObjects;
const explorableObjects = require("./permittedObjects.js").explorableObjects;
const util = require("./utilities.js");
const winston = require("winston");

require('dotenv').config();

let loggerOptions = {
    file: {
        level: "info",
        filename: "./Logs/app.log",
        handleExceptions: true,
        json: true,
        maxsize: 5242880,
        maxFiles: 5,
        colorize: false
    },
    console: {
        level: "error",
        handleExceptions: true,
        json: false,
        colorize: true
    }
}

let logger = new winston.createLogger({
    transports: [
        new winston.transports.File(loggerOptions.file),
        new winston.transports.Console(loggerOptions.console)
    ],
    exitOnError: false
});

let objectMetadataMap = {};
let loginOptions = { loginUrl: process.env.SF_SOURCE_ORG_URL };
let conn = new jsforce.Connection(loginOptions);
let recordObject = {};

conn.login(process.env.PROD_USER, process.env.PROD_PASS, (err, userInfo) => {
    if (err) logger.log("error", err);

    logger.log("info", "Logged into " + conn.instanceUrl + " as " + userInfo.id);
    buildMetadataMap()
        .then(() => {
            let keys = Object.keys(objectMetadataMap);
            for (let i = 0; i < keys.length; i++) {
                if (!objectMetadataMap[keys[i]]) {
                    delete objectMetadataMap[keys[i]];
                }
            }
            logger.log("info", "Finished building metadata map :: " + JSON.stringify(objectMetadataMap));
            logger.log("info", "Object metadata map keys :: " + Object.keys(objectMetadataMap));
            return buildDataTree("Loan__c");
        }).then((res) => {
            let tree = res;
            tree.print();
            logger.log("info", "Tree :: " + tree.print());
            logger.log("info", JSON.stringify(tree, (key, value) => {
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
            logger.log("info", "Finished building record object :: " + recordObject);
            util.createDir("./" + process.env.DATA_FOLDER_NAME);
            util.writeFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.DATA_FILE_NAME, JSON.stringify(recordObject)).catch(err => logger.log("error", err));
            util.writeFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.METADATA_FILE_NAME, JSON.stringify(objectMetadataMap)).catch(err => logger.log("error", err));
        }).catch((err) => {
            logger.log("error", err);
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
                    logger.log("error", err);
                });
        }
    });
}

function buildDataTree(rootObject) {
    return new Promise((resolve, reject) => {
        try {
            let tree = new Tree(rootObject);
            tree.traverseBF((currentNode) => {
                logger.log("info", "Current Node :: " + currentNode.objectName);
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
        logger.log("debug", queryString);

        if (queryString) {
            query(queryString).then((records) => {
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
                if (field.updateable || field.name.includes("__c") || field.name === "Id")
                    fields.push(field.name);
            });
            queryString += fields.join(",");

            queryString += " FROM " + currentNode.objectName + " WHERE Id in ('a000Z00000ibcyVQAQ', 'a000Z00000ibcy5QAA') LIMIT ";
            queryString += limit;
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
                    if (field.updateable || field.name.includes("__c") || field.name === "Id")
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

