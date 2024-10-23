require("dotenv").config() ; 
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const serverless = require('serverless-http');
const cors = require("cors");


// MongoDB connection
mongoose.connect(
  process.env.MONGODB_URL ,
  { useNewUrlParser: true, useUnifiedTopology: true }
);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));

// Define the Rule Schema
const ruleSchema = new mongoose.Schema({
  rule_string: { type: String, required: true },
  ast: { type: Object, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

const Rule = mongoose.model("Rule", ruleSchema);

// Initialize the Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// AST Node constructor
class ASTNode {
  constructor(type, left = null, right = null, value = null) {
    this.type = type;
    this.left = left;
    this.right = right;
    this.value = value;
  }

  toJSON() {
    return {
      type: this.type,
      left: this.left ? this.left.toJSON() : null,
      right: this.right ? this.right.toJSON() : null,
      value: this.value,
    };
  }
}

// Parse rule logic
function parseRule(ruleString) {
  const operatorPattern = /\s*(AND|OR)\s*/;
  const operandPattern =
    /([a-zA-Z_][a-zA-Z0-9_.]*\s*(>=|<=|>|<|=|!=)\s*'?[a-zA-Z0-9_.]+'?)/;

  let tokens = ruleString.split(operatorPattern);
  let currentNode = null;
  let operatorStack = [];

  tokens.forEach((token) => {
    token = token.trim();
    if (operandPattern.test(token)) {
      let node = new ASTNode("operand", null, null, token);
      if (!currentNode) currentNode = node;
      else {
        let lastOperator = operatorStack.pop();
        currentNode = new ASTNode("operator", currentNode, node, lastOperator);
      }
    } else if (token === "AND" || token === "OR") {
      operatorStack.push(token);
    }
  });

  return currentNode;
}

// Combine multiple rules into one AST
function combineRules(rules) {
  if (!rules.length) return null;

  let combinedAST = parseRule(rules[0]);
  for (let i = 1; i < rules.length; i++) {
    let newAST = parseRule(rules[i]);
    combinedAST = new ASTNode("operator", combinedAST, newAST, "AND");
  }

  return combinedAST;
}

// Evaluate AST against data
function evaluateRule(astNode, data) {
  if (!astNode) return false;
  return evalNode(astNode, data);
}

// Recursive AST evaluation
function evalNode(node, data) {
  if (node.type === "operand") {
    return evaluateOperand(node.value, data);
  }

  const leftValue = evalNode(node.left, data);
  const rightValue = evalNode(node.right, data);

  if (node.value === "AND") {
    return leftValue && rightValue;
  } else if (node.value === "OR") {
    return leftValue || rightValue;
  } else {
    throw new Error(`Unknown operator: ${node.value}`);
  }
}

// Evaluate individual operand (e.g., age > 30)
function evaluateOperand(operand, data) {
  const operandPattern =
    /([a-zA-Z_][a-zA-Z0-9_.]*)\s*(>=|<=|>|<|=|!=)\s*'?(.*?)'?$/;
  const match = operand.match(operandPattern);

  if (!match) {
    throw new Error(`Invalid operand: ${operand}`);
  }

  const [_, attribute, operator, value] = match;
  const attributeValue = data[attribute];

  if (attributeValue === undefined) {
    return false;
  }

  switch (operator) {
    case ">":
      return attributeValue > value;
    case "<":
      return attributeValue < value;
    case ">=":
      return attributeValue >= value;
    case "<=":
      return attributeValue <= value;
    case "=":
      return attributeValue == value; // Note: Use == to allow type coercion
    case "!=":
      return attributeValue != value;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

// POST: Create Rule
app.post("/create_rule", async (req, res) => {
  const { rule } = req.body;
  try {
    const astNode = parseRule(rule);
    const newRule = new Rule({ rule_string: rule, ast: astNode.toJSON() });
    await newRule.save();
    res.json({ ast: newRule.ast });
  } catch (error) {
    res.status(400).json({ error: "Error creating rule" });
  }
});

// POST: Combine Rules
app.post("/combine_rules", async (req, res) => {
  const { rules } = req.body;
  if (!rules || !rules.length) {
    return res.status(400).json({ error: "No rules provided" });
  }

  try {
    const combinedAST = combineRules(rules);
    res.json({ ast: combinedAST.toJSON() });
  } catch (error) {
    res.status(400).json({ error: "Error combining rules" });
  }
});

// POST: Evaluate Rule
app.post("/evaluate_rule", (req, res) => {
  const { ast, data } = req.body;
  if (!ast || !data) {
    return res.status(400).json({ error: "AST or data missing" });
  }

  try {
    const astNode = new ASTNode(ast.type, ast.left, ast.right, ast.value);
    const result = evaluateRule(astNode, data);
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: "Error evaluating rule" });
  }
});

// PUT: Modify Existing Rule
app.put("/modify_rule/:id", async (req, res) => {
  const ruleId = req.params.id;
  const { rule } = req.body;

  try {
    const astNode = parseRule(rule);
    const updatedRule = await Rule.findByIdAndUpdate(
      ruleId,
      {
        rule_string: rule,
        ast: astNode.toJSON(),
        updated_at: Date.now(),
      },
      { new: true }
    );

    if (!updatedRule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    res.json({ ast: updatedRule.ast });
  } catch (error) {
    res.status(400).json({ error: "Error modifying rule" });
  }
});

// Server start
const PORT = 5000 || process.env.port;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

module.exports.handler = serverless(app);
