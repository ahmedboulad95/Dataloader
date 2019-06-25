const Node = require("./Node.js");

class Tree {
    constructor(data) {
        this.root = new Node(data);;
    }

    traverseDf(callback) {
        (function recurse(currentNode) {
            for(let i = 0, length = currentNode.children.length; i < length; i++) {
                recurse(currentNode.children[i]);
            }

            callback(currentNode);
        })(this.root);
    }

    traverseBF(callback) {
        let queue = [];
        queue.push(this.root);
        let currentNode = queue.shift();
        while(currentNode) {
            callback(currentNode);
            for(let i = 0, length = currentNode.children.length; i < length; i++) {
                queue.push(currentNode.children[i]);
            }
            currentNode = queue.shift();
        }
    }

    contains(objectToFind) {
        let res = null;
        this.traverseDf((currentNode) => {
            if(currentNode.objectName === objectToFind) {
                res = currentNode;
            }
        });
        return res;
    }

    add(data, parentData) {
        let child = new Node(data);
        let parent = this.contains(parentData);

        if(parent) {
            parent.children.push(child);
            child.parent = parent;
        } else {
            throw "Cannot add node to non-existant parent.";
        }
    }

    print() {
        this.traverseBF((currentNode) => {
            console.log(currentNode.objectName + ((currentNode.parent !== null) ? (" Parent: " + currentNode.parent.objectName) : ""));
        });
    }
}

module.exports = Tree;