"use strict";

const jsforce = require("jsforce");
const PDFDocument = require("pdfkit");
const fs = require("fs");
//const _ = require("lodash");
const Tree = require("./includes/Tree.js");
const util = require("./includes/utilities.js");
const logger = require("./includes/logger.js");

require('dotenv').config();

let objectMetadataMap = {};
let loginOptions = { loginUrl: process.env.DEV_SF_SOURCE_ORG_URL };
let conn = new jsforce.Connection(loginOptions);
let recordObject = {};

let permittedObjects = require("./includes/objectOrder.js").permittedObjects.slice();
let explorableObjects = require("./includes/objectOrder.js").explorableObjects.slice();

let userId = "";

const logPath = "./logs/constructTestSet.log";

conn.login(process.env.DEV_SF_SOURCE_ORG_USER, process.env.DEV_SF_SOURCE_ORG_PASS + process.env.DEV_SF_SOURCE_ORG_TOKEN, (err, userInfo) => {
    if (err) {
        logger.log("error", err);
        console.log("Error logging in");
        throw err;
    }

    userId = userInfo.id;

    logger.log(logPath, logger.debug.INFO, "Logged into " + conn.instanceUrl + " as " + userInfo.id);
    buildMetadataMap().then(() => {
        let keys = Object.keys(objectMetadataMap);
        for (let i = 0; i < keys.length; i++) {
            if (!objectMetadataMap[keys[i]]) {
                delete objectMetadataMap[keys[i]];
            }
        }
        console.log("Finished building metadata map");
        logger.log(logPath, logger.debug.INFO, "Finished building metadata map");
        logger.log(logPath, logger.debug.INFO, "Object metadata map keys :: " + Object.keys(objectMetadataMap));
        return buildDataTree("Loan__c");
    }).then((res) => {
        console.log("Finished building data tree");
        let tree = res;
        tree.print();
        //logger.log(logPath, logger.debug.INFO, "Tree :: " + tree.print());
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
        console.log("Finished building record object");
        logger.log(logPath, logger.debug.INFO, "Finished building record object :: Size " + Object.keys(recordObject).length);

        let keys = Object.keys(recordObject);
        for (let i = 0; i < keys.length; i++) {
            if (recordObject[keys[i]].length === 0) {
                console.log(`Deleting ${keys[i]}`);
                delete recordObject[keys[i]];
            }
        }

        return fetchAttachments(recordObject["Attachment"]);
    }).then(() => {
        util.createDir("./" + process.env.DATA_FOLDER_NAME);
        util.writeFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.DATA_FILE_NAME, JSON.stringify(recordObject)).catch(err => logger.log("error", err));
        util.writeFile("./" + process.env.DATA_FOLDER_NAME + "/" + process.env.METADATA_FILE_NAME, JSON.stringify(objectMetadataMap)).catch(err => logger.log("error", err));

        console.log("Operation complete");
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
                    logger.log(logPath, logger.debug.INFO, `Retrieved metadata for ${permittedObjects[i]}`);
                    console.log(`Permitted objects: ${permittedObjects.length} , Count: ${count}`);
                    if (count === permittedObjects.length - 1)
                        resolve();

                    count++;
                }).catch((err) => {
                    console.log(`Error ${err}`);
                    logger.log(logPath, logger.debug.INFO, `Failed to retrieve metadata for ${permittedObjects[i]}`);
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
                                    addNodeIfNotInTree(tree, currObject, currentNode.objectName, metadata.fields[i].name, "childRel");
                                }
                            }
                        }
                    }

                    for (let i = 0; i < metadata.childRelationships.length; i++) {
                        let currObject = metadata.childRelationships[i];
                        if (permittedObjects.indexOf(currObject.childSObject) !== -1) {
                            addNodeIfNotInTree(tree, currObject.childSObject, currentNode.objectName, metadata.childRelationships[i].field, "lookup");
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

function addNodeIfNotInTree(tree, currObject, objectName, fieldName, relType) {
    let node = tree.contains(currObject);
    if (node && currObject != "Attachment") {
        node.addRelatedField(fieldName, relType);
    } else {
        let newNode = tree.add(currObject, objectName);
        newNode.addRelatedField(fieldName, relType);
    }
}

function doQuery(currentNode, tree) {
    return new Promise((resolve, reject) => {
        console.log(`Doing query for :: ${currentNode.objectName}`);
        logger.log("info", "Doing query for :: " + currentNode.objectName);
        let queryString = null;

        if (currentNode === tree.root) {
            queryString = buildQueryString(currentNode, 200);
        } else {
            queryString = buildQueryString(currentNode, null);
        }
        logger.log(logPath, logger.debug.DEBUG, queryString);
        console.log(`Query String :: ${queryString}`);

        if (queryString) {
            query(queryString).then((records) => {
                for (let i = 0; i < records.length; i++) {
                    if (records[i].OwnerId)
                        records[i].OwnerId = userId;
                }

                recordObject[currentNode.objectName] = records;
                resolve();
            }).catch((err) => {
                console.log(`Error querying for ${currentNode.objectName} :: ${err}`);
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

function buildQueryString(currentNode, limit) {
    let metadata = objectMetadataMap[currentNode.objectName];

    let queryString = null;

    if (metadata) {
        if (limit) {
            let fields = [];
            metadata.fields.forEach((field) => {
                if (field.createable || field.name === "Id")
                    fields.push(field.name);
            });

            //queryString = `SELECT ${fields.join(",")} FROM ${currentNode.objectName} LIMIT ${limit}`;
            //queryString = `SELECT ${fields.join(",")} FROM ${currentNode.objectName} WHERE Id in ('a000Z00000ibcyVQAQ', 'a000Z00000ibcy5QAA', 'a000Z00000iU2xkQAC')`;
            //queryString = `SELECT ${fields.join(",")} FROM ${currentNode.objectName} WHERE Id in ('a000Z00000cUkojQAC', 'a000Z00000cUkooQAC', 'a000Z00000cUkpDQAS')`;
            queryString = `SELECT ${fields.join(",")} FROM ${currentNode.objectName} WHERE Id in ('a000Z00000kA7m5QAC')`;
            //queryString = `SELECT ${fields.join(",")} FROM ${currentNode.objectName} WHERE Id in ('a000Z00000j9fNM','a000Z00000j9fNO','a000Z00000j9fNS','a000Z00000j9fNV','a000Z00000j9fNZ','a000Z00000j9fNa','a000Z00000j9fNc','a000Z00000j9fNe','a000Z00000j9fNj','a000Z00000j9fNm','a000Z00000j9fO8','a000Z00000j9fOO','a000Z00000j9fOP','a000Z00000j9fOQ','a000Z00000j9fOa','a000Z00000j9fOf','a000Z00000j9fOh','a000Z00000j9fOj','a000Z00000j9fOm','a000Z00000j9fOo','a000Z00000j9fOp','a000Z00000j9fOr','a000Z00000j9fOu','a000Z00000j9fOw','a000Z00000j9fP1','a000Z00000j9fP4','a000Z00000j9fP8','a000Z00000j9fPA','a000Z00000j9fPB','a000Z00000j9fPC','a000Z00000j9fPI','a000Z00000j9fPR','a000Z00000j9fPV','a000Z00000j9fPW','a000Z00000j9fPX','a000Z00000j9fPY','a000Z00000j9fQO','a000Z00000j9fQP','a000Z00000j9fQS','a000Z00000j9fQV','a000Z00000j9fQb','a000Z00000j9fQd','a000Z00000j9fQe','a000Z00000j9fQg','a000Z00000j9fQh','a000Z00000j9fQp','a000Z00000j9fQw','a000Z00000j9fR1','a000Z00000j9fR4','a000Z00000j9fR6','a000Z00000j9fR8','a000Z00000j9fRC','a000Z00000j9fRD','a000Z00000j9fRE','a000Z00000j9fRF','a000Z00000j9fRJ','a000Z00000j9fRK','a000Z00000j9fRM','a000Z00000j9fRN','a000Z00000j9fRS','a000Z00000j9fRT','a000Z00000j9fRX','a000Z00000j9fRZ','a000Z00000j9fRa','a000Z00000j9fRc','a000Z00000j9fRe','a000Z00000j9fRf','a000Z00000j9fRg','a000Z00000j9fRl','a000Z00000j9fRw','a000Z00000j9fRy','a000Z00000j9fS7','a000Z00000j9fSB','a000Z00000j9fSD','a000Z00000j9fSb','a000Z00000j9fSi','a000Z00000j9fSk','a000Z00000j9fSq','a000Z00000j9fSr','a000Z00000j9fSt','a000Z00000j9fSu','a000Z00000j9fSz','a000Z00000j9fT8','a000Z00000j9fT9','a000Z00000j9fTD','a000Z00000j9fTF','a000Z00000j9fTK','a000Z00000j9fTL','a000Z00000j9fTP','a000Z00000j9fTR','a000Z00000j9fTX','a000Z00000j9fTc','a000Z00000j9fTe','a000Z00000j9fTg','a000Z00000j9fTi','a000Z00000j9fUO','a000Z00000j9fUR','a000Z00000j9fUU','a000Z00000j9fUV','a000Z00000j9fUZ','a000Z00000j9fUe','a000Z00000j9fUi','a000Z00000j9fUl','a000Z00000j9fUm','a000Z00000j9fUq','a000Z00000j9fUr','a000Z00000j9fUz','a000Z00000j9fV7','a000Z00000j9fV8','a000Z00000j9fVE','a000Z00000j9fVI','a000Z00000j9fVL','a000Z00000j9fVM','a000Z00000j9fVO','a000Z00000j9fWD','a000Z00000j9fWF','a000Z00000j9fWG','a000Z00000j9fWI','a000Z00000j9fWJ','a000Z00000j9fWM','a000Z00000j9fWN','a000Z00000j9fWS','a000Z00000j9fWU','a000Z00000j9fWV','a000Z00000j9fWd','a000Z00000j9fWe','a000Z00000j9fWf','a000Z00000j9fWh','a000Z00000j9fWn','a000Z00000j9fWp','a000Z00000j9fWq','a000Z00000j9fWs','a000Z00000j9fWv','a000Z00000j9fWw','a000Z00000j9fWy','a000Z00000j9fX0','a000Z00000j9fX2','a000Z00000j9fX6','a000Z00000j9fX9','a000Z00000j9fXH','a000Z00000j9fXK','a000Z00000j9fXN','a000Z00000j9fXS','a000Z00000j9fXU','a000Z00000j9fXV','a000Z00000j9fXY','a000Z00000j9fXe','a000Z00000j9fYi','a000Z00000j9fYl','a000Z00000j9fYm','a000Z00000j9fYw','a000Z00000j9fZ0','a000Z00000j9fZ2','a000Z00000j9fZ3','a000Z00000j9fZ4','a000Z00000j9fZ5','a000Z00000j9fZ7','a000Z00000j9fZB','a000Z00000j9fZD','a000Z00000j9fa7','a000Z00000j9faB','a000Z00000j9faD','a000Z00000j9faM','a000Z00000j9faN','a000Z00000j9faP','a000Z00000j9faQ','a000Z00000j9faR','a000Z00000j9fcU','a000Z00000j9fds','a000Z00000j9fdt','a000Z00000j9fdw','a000Z00000j9feR','a000Z00000j9feS','a000Z00000j9feT','a000Z00000j9feW','a000Z00000j9feY','a000Z00000j9fec','a000Z00000j9fed','a000Z00000j9ffB','a000Z00000j9ffD','a000Z00000j9ffF','a000Z00000j9ffI','a000Z00000j9ffh','a000Z00000j9ffi','a000Z00000j9ffj','a000Z00000j9ffo','a000Z00000j9ffp','a000Z00000j9fft','a000Z00000j9fgA','a000Z00000j9fgB','a000Z00000j9fgC','a000Z00000j9fgG','a000Z00000j9fgH','a000Z00000j9fgK','a000Z00000j9fgM','a000Z00000j9fgS','a000Z00000j9fgX','a000Z00000j9fgY','a000Z00000j9fgt','a000Z00000j9fgu')`;
        } else {
            let parents = recordObject[currentNode.parent.objectName];
            let conditionals = [];

            if (parents) {
                currentNode.relatedFields.forEach((relatedField) => {
                    let relField = null;
                    let recIds = [];
                    let conditional = "";

                    if (relatedField.relationshipType === 'lookup') {
                        relField = relatedField.fieldName;

                        for (let i = 0; i < parents.length; i++) {
                            if(recIds.indexOf(`'${parents[i].Id}'`) === -1) {
                                recIds.push(`'${parents[i].Id}'`);
                            }
                        }
                    } else {
                        relField = "Id";

                        for (let i = 0; i < parents.length; i++) {
                            if (parents[i][relatedField.fieldName] && recIds.indexOf(`'${parents[i][relatedField.fieldName]}'`) === -1) {
                                recIds.push(`'${parents[i][relatedField.fieldName]}'`);
                            }
                        }
                    }

                    conditional = `${relField} IN (${recIds.join(",")})`;

                    if (recIds.length > 0) {
                        conditionals.push(conditional);
                    }
                });

                if (conditionals.length > 0) {
                    let fields = [];
                    metadata.fields.forEach((field) => {
                        if (field.createable || field.name === "Id")
                            fields.push(field.name);
                    });

                    queryString = `SELECT ${fields.join(",")} FROM ${currentNode.objectName} WHERE ${conditionals.join(" OR ")}`;
                }
            }
        }
    }

    //console.log(queryString);
    return queryString;
}

function isUserActive(userId) {
    return new Promise((resolve, reject) => {
        query(`SELECT IsActive FROM User WHERE Id = '${userId}'`).then((records) => {
            if (records) {
                resolve(records[0].IsActive);
            }
        }).catch(err => reject(err));
    });
}

function updateOwners() {

}

function fetchAttachments(attachments) {
    return new Promise((resolve, reject) => {
        console.log("Fetching attachments");
        let attachmentDownloads = [];
        attachments.forEach((attachment) => {
            attachmentDownloads.push(downloadAttachment(attachment));
        });
        console.log("All attachments have been queued for download");
        Promise.all(attachmentDownloads).then(() => {
            resolve();
        }).catch(err => {console.log(`Error with one or more attachments ${err}`); reject(err)});
    });
}

function downloadAttachment(attachment) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading ${attachment.Id}`);

        let fileOut = fs.createWriteStream(`./attachments/${attachment.Id}.pdf`);
        let stream = conn.sobject("Attachment").record(attachment.Id).blob("Body").pipe(fileOut);

        stream.on("error", err => reject(err));
        stream.on("end", () => {
            fs.readFile(`./attachments/${attachment.Id}.pdf`, (err, data) => {
                if(err) reject(err);

                attachment["Body"] = new Buffer.from(data).toString("base64");
                resolve();
            });
        });
    });
}