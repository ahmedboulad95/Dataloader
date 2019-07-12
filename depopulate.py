import os
from os.path import join, dirname
from dotenv import load_dotenv
import SQLForce
import json
import pprint

pp = pprint.PrettyPrinter(indent=4)

yesConditions = ["y", "yes"]

dotenv_path = join(dirname(__file__), '.env')
load_dotenv(dotenv_path)

loginUrl = os.environ.get("DEV_SF_DEST_ORG_URL")
loginUser = os.environ.get("DEV_SF_DEST_ORG_USER")
loginPass = os.environ.get("DEV_SF_DEST_ORG_PASS")
loginToken = os.environ.get("DEV_SF_DEST_ORG_TOKEN")

if input(f"{'*'*30}\nWARNING: This action will depopulate the entire salesforce database at {loginUrl} with the user {loginUser}. Continue? (y/n) ").lower() in yesConditions:
    session = SQLForce.Session("Sandbox", loginUser, loginPass, loginToken)

    with open("objectRes.json") as json_file:
        data = json.load(json_file)

    for obj in data["permittedObjects"]:
        idsToDelete = []
        records = []
        try:
            records = session.selectRecords(f"SELECT ID FROM {obj}")
        except:
            print(f"Error querying {obj}")

        for record in records:
            print(f"one record {obj}")
            idsToDelete.append(record.ID)

        if not idsToDelete:
            print(f"No records for {obj}")
            continue

        nThisTime = session.delete(obj, idsToDelete)
        print(f"Deleted {nThisTime} records from {obj}")
else:
    print("Aborting...")
