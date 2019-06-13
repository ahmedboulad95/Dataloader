const jsforce = require("jsforce");
const fs = require("fs");
const permittedObjects = require('./permittedObjects.js');

// Establish a connection to Salesforce
var loginOptions = {
  loginUrl: "https://test.salesforce.com"
};
let conn = new jsforce.Connection(loginOptions);

console.log("Logging into Salesforce...");
conn.login(
  "aboulad@autoidinc.com",
  "Ahmdb_95_partialILZWV1mHuUZU6pv48WjzIQtV",
  function (err, userInfo) {
    if (err) console.log("Failed to login :: " + err);

    console.log("Successfully logged in");
    console.log("- Access Token :: " + conn.accessToken);
    console.log("- Instance URL :: " + conn.instanceUrl);
    console.log("- User Id :: " + userInfo.id);

    // Grab the Loan__c object metadata
    console.log("Fetching Loan__c metadata...");
    conn.sobject("Loan__c").describe((err, metadata) => {
      if (err) console.log("Error :: " + err);

      console.log("Successfully retrieved Loan__c metadata");

      let lookupObjects = {};

      console.log("Building initial lookup object...");
      // Loop through all the Loan object fields
      metadata.fields.forEach(element => {
        // Check if field is a lookup
        if (element.referenceTo.length > 0) {
          // Field could reference multiple objects
          element.referenceTo.forEach(objectName => {
            //console.log(objectName);
            // Only add object if it hasn't been added already and it is not one of the omitted objects
            if (permittedObjects.indexOf(objectName) !== -1) {
              //lookupFields.push(element.name);
              //console.log("Element :: " + element.name);
              if (lookupObjects[objectName])
                lookupObjects[objectName].fields.push(element.name);
              else {
                lookupObjects[objectName] = {};
                lookupObjects[objectName].fields = [];
                lookupObjects[objectName].fields.push(element.name);
              }
            }
          });
        }
      });

      //console.log("Lookup Objects :: " + JSON.stringify(lookupObjects));

      console.log("Building Loan__c query...");
      // Dynamically build the Loan query
      let queryString = "SELECT ";
      let fields = [];
      metadata.fields.forEach((element) => {
        fields.push(element.name);
      });

      queryString += fields.join(",");

      queryString += " FROM Loan__c LIMIT 20";

      console.log("Querying for Loans...");
      let records = [];
      let query = conn.query(queryString)
        .on("record", (record) => {
          //console.log(record);
          records.push(record);
        })
        .on("end", () => {
          // Write loans to a file
          /*fs.writeFile(
            "loans.json",
            JSON.stringify(records),
            function (err) {
              if (err) console.log("Error writing file :: " + err);
            }
          );*/
          console.log("Retrieved Loans successfully");

          console.log("Retrieving related object metadata...");
          getMetadata(lookupObjects).then((response) => {
            console.log("Retrieved metadata successfully");
            lookupObjects = response;

            console.log("Adding record ids to lookup object...");
            // Grab all of the related record ids
            for (key in lookupObjects) {
              lookupObjects[key].recordIds = [];
              records.forEach((loan) => {
                lookupObjects[key].fields.forEach((field) => {
                  if (loan[field])
                    lookupObjects[key].recordIds.push(loan[field]);
                });
              });
            }

            console.log("Building queries for related objects...");
            console.log("\n");

            // Build query for each related object

            getRelatedObjects(lookupObjects).then((response) => {
              console.log("Adding related records to lookup object... ");
              lookupObjects = response;
              /*fs.writeFile(
                "lookupObjects.json",
                JSON.stringify(lookupObjects),
                function (err) {
                  if (err) console.log("Error writing file :: " + err);
                }
              );*/
            });
          });

          //console.log("Related Records :: " + relObjectRecordIds);
          //relObjectRecordIds.forEach((recordIds) => {

          //});
        })
        .on("error", (err) => {
          console.log("Error :: " + err);
        })
        .run({ autoFetch: true, maxFetch: 20 });

      //console.log("\n");
      //console.log(lookupObjects);
    });
  }
);

function getMetadata(lookupObjects) {
  return new Promise((resolve, reject) => {
    let relObjectsMap = lookupObjects;
    let keys = Object.keys(relObjectsMap)

    let counter = 0;
    for (let i = 0; i < keys.length; i++) {
      //lookupObjects.forEach((obj) => {
      // Fetch the metadata for each related object

      conn.sobject(keys[i]).describe((err, relObjMetadata) => {
        if (err) reject(err);
        //console.log((relObjMetadata) ? "" : "Undefined for " + keys[i]);

        // Write the metadata out to a file
        /*let fileName = objectName + '.json';
                    fs.writeFile(fileName, JSON.stringify(relObjMetadata), (err) => {
                        if(err) console.log('Error writing file :: ' + err);
                    });*/

        // Add metadata to related objects map
        relObjectsMap[keys[i]].metadata = relObjMetadata;

        // Return the map if on the last element
        if (counter === keys.length - 1) {
          resolve(relObjectsMap);
        }
        counter++;
      });
    }
  })
}

function getRelatedObjects(obj) {
  return new Promise((resolve, reject) => {
    let lookupObjects = obj;
    let counter = 0;
    let numObjects = 0;
    let keys = Object.keys(lookupObjects);
    for (let i = 0; i < keys.length; i++) {
      if (lookupObjects[keys[i]].recordIds.length > 0) {
        numObjects++;
        lookupObjects[keys[i]].records = [];
        let relQueryString = "SELECT ";
        let relFields = [];
        lookupObjects[keys[i]].metadata.fields.forEach((element) => {
          relFields.push(element.name);
        });
        relQueryString += relFields.join(",");

        relQueryString += " FROM " + keys[i] + " WHERE ";
        let whereClauses = [];
        let clause = "Id IN (";

        let ids = [];
        lookupObjects[keys[i]].recordIds.forEach((id) => {
          ids.push("'" + id + "'");
        });
        clause += ids.join(',');
        clause += ') ';
        whereClauses.push(clause);
        relQueryString += whereClauses.join(' OR ');

        console.log(relQueryString);
        console.log("\n");

        conn.query(relQueryString).on("record", (record) => {
          lookupObjects[keys[i]].records.push(record);
        }).on("end", () => {
          console.log("Num Objects :: " + numObjects);
          console.log("in end");
          console.log(counter);
          if (counter === numObjects-1) {
            console.log("Fetching related objects completed");
            resolve(lookupObjects);
          }
          counter++;
          /*fs.writeFile(
            "lookupObjects.json",
            JSON.stringify(lookupObjects),
            function (err) {
              if (err) console.log("Error writing file :: " + err);
            }
          );*/
        }).on("error", (err) => {
          console.log("Error :: " + err);
        }).run({ autoFetch: true });
      }
    }
  });
}