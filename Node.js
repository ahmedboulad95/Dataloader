class Node {
    constructor(data) {
        this.objectName = data;
        this.parent = null;
        this.children = [];
    }

    print() {
        console.log(this.objectName);
    }
}

module.exports = Node;