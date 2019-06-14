const jsforce = require("jsforce");
const fs = require("fs");
const permittedObjects = require('./permittedObjects.js');

// Establish a connection to Salesforce
var loginOptions = {
    loginUrl: "https://test.salesforce.com"
};
let conn = new jsforce.Connection(loginOptions);

let recordObj = {};

let objMetadata = {};

console.log("Logging into Salesforce...");
conn.login("aboulad@autoidinc.com", "Ahmdb_95_partialILZWV1mHuUZU6pv48WjzIQtV", (err, userInfo) => {

});

function getRecordsDFS(currentObj, parentIds, parentObj) {
    // Grab current object metadata

    getObjectMetadata(currentObj).then((metadata) => {
        let currentObjMetadata = metadata;

        currentObjMetadata.childRelationships.forEach((rel) => {
            if(rel.childSObject === parentObj) {
                let parentRelIds = [];
                recordObj[parentObj].forEach((parentRecord) => {
                    parentRelIds.push(parentRecord[rel.field]);
                });

                // Need to grab the records based on Id In parentObj[rel.field]
                fetchRecords(currentObj, currentObjMetadata, "Id", parentRelIds).then((records) => {
                    if(recordObj[currentObj]) {
                        records.forEach((record) => {
                            // Add the records to the global record object if they do not exist there
                            if(recordObj[currentObj].indexOf(record) === -1) {
                                recordObj[currentObj].push(record);
                            }
                        });
                    }
                }).catch((err) => {
                    console.log("Error querying records :: " + err);
                });
            }
        });

        currentObjMetadata.fields.forEach((field) => {
            if(field.referenceTo.length > 0 && field.referenceTo.includes(parentObj)) {
                // Need to grab the records based on field.name In ParentIds
            }
        });
    }).catch((err) => {
        console.log("Error getting current object metadata :: " + err);
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
        let counter = 0;

        let queryString = "SELECT ";
        let fields = [];
        metadata.fields.forEach((field) => {
            if(field.updateable || field.name.includes("__c") || field.name === "Id")
                fields.push(field.name);
        });
        queryString += fields.join(",");

        queryString += " FROM " + currentObj + " WHERE " + relField + " IN (";
        let ids = [];
        recIds.forEach((id) => {
            ids.push("'" + id + "'");
        });
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