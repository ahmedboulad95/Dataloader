import os
from os.path import join, dirname
from dotenv import load_dotenv
import SQLForce
import json
from pprint import pprint

yesConditions = ["y", "yes"]

dotenv_path = join(dirname(__file__), '.env')
load_dotenv(dotenv_path)

loginUrl = os.environ.get("SF_DEST_ORG_URL")
loginUser = os.environ.get("SF_DEST_ORG_USER")
loginPass = os.environ.get("SF_DEST_ORG_PASS")
loginToken = os.environ.get("SF_DEST_ORG_TOKEN")

if input(f"{'*'*30}\nWARNING: This action will depopulate the entire salesforce database at {loginUrl} with the user {loginUser}. Continue? (y/n) ").lower() in yesConditions:
    session = SQLForce.Session("Production", loginUser, loginPass, loginToken)

    with open("objectRes.json") as json_file:
        data = json.load(json_file)

    for obj in data.permittedObjects:
        session.runCommands("DELETE FROM " + obj)
        print(f"Rows deleted from {obj} :: {session.getenv('ROW_COUNT')}")
else:
    print("Aborting...")
