# Dataloader

This application allows you to pull a complete set of test data from a Salesforce org, and push the data into another org. You specify which sObject you would like to pull and the application will pull records for that object as well as all related records.

## Getting Started

### Installing
```
npm install
```
### Running the Application

#### To Pull Data
Format: node pullTestData.js SOBJECT_NAME LIMIT
```
node pullTestData.js Account 100
```
A data folder is created at runtime to store the records in json format.

#### To Push Data
```
node pushTestData.js
```
The records are pulled from a file in the data folder.
