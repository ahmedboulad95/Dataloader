const RelatedField = require("./RelatedField.js");

class Node {

    // Relationship type can be:
    //  - Lookup - means the current node has a lookup field to the parent node
    //  - childRel - means the parent node has a lookup field to the child node
    constructor(data) {
        this.objectName = data;
        this.relatedFields = [];
        this.parent = null;
        this.children = [];
    }

    addRelatedField(fieldName, relationshipType) {
        this.relatedFields.push(new RelatedField(fieldName, relationshipType));
    }

    print() {
        console.log(this.objectName);
    }
}

module.exports = Node;