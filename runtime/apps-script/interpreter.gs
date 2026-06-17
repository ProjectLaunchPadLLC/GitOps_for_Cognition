///////////////////////////////
// CGS-003 RUNTIME KERNEL v0.1
// Cognitive Control Plane
///////////////////////////////

/**
 * Entry point: executes a CGS workflow DAG
 * @param {Object} workflow - CGS-003 workflow JSON
 * @param {Object} initialState - initial cognitive state
 */
function executeDAG(workflow, initialState) {
  const state = initialState || {};
  const nodes = indexNodes(workflow.nodes);

  let currentNodeId = workflow.entry_node || workflow.nodes[0].id;
  let safetyCounter = 0;

  while (currentNodeId) {
    safetyCounter++;
    if (safetyCounter > 50) {
      throw new Error("CGS_RUNTIME: Execution halted (loop safety limit reached)");
    }

    const node = nodes[currentNodeId];
    if (!node) {
      throw new Error("CGS_RUNTIME: Node not found -> " + currentNodeId);
    }

    logState("ENTER_NODE", currentNodeId, state);

    // EXECUTE NODE
    const result = executeNode(node, state);

    // MERGE OUTPUTS INTO STATE
    stateMerge(state, result);

    logState("EXIT_NODE", currentNodeId, state);

    // DETERMINE NEXT NODE
    currentNodeId = resolveNextNode(workflow, node, state);
  }

  return state;
}

/**
 * Index nodes for O(1) lookup
 */
function indexNodes(nodes) {
  const map = {};
  nodes.forEach(n => map[n.id] = n);
  return map;
}

/**
 * Executes a single CGS node
 */
function executeNode(node, state) {

  switch (node.action) {

    ///////////////////////////////
    // LLM INFERENCE NODE
    ///////////////////////////////
    case "llm_inference":
      return runLLMNode(node, state);

    ///////////////////////////////
    // TOOL EXECUTION NODE
    ///////////////////////////////
    case "tool_execution":
      return runToolNode(node, state);

    ///////////////////////////////
    // POLICY / GOVERNANCE NODE
    ///////////////////////////////
    case "policy_check":
      return runGovernanceNode(node, state);

    default:
      throw new Error("CGS_RUNTIME: Unknown node action -> " + node.action);
  }
}

/**
 * LLM node (stubbed via UrlFetchApp)
 */
function runLLMNode(node, state) {

  const prompt = buildPrompt(node, state);

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a CGS cognitive node executor." },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  };

  const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY")
    },
    payload: JSON.stringify(payload)
  });

  const json = JSON.parse(res.getContentText());
  const output = json.choices[0].message.content;

  return mapOutputs(node.outputs, output);
}

/**
 * TOOL NODE (safe execution layer)
 */
function runToolNode(node, state) {

  // Example: Google Docs tool
  if (node.tool_ref === "tools/google_docs_create") {

    const doc = DocumentApp.create("CGS Generated Document");
    doc.getBody().setText(JSON.stringify(state, null, 2));

    return {
      document_id: doc.getId(),
      document_url: doc.getUrl()
    };
  }

  // Example: logging tool
  if (node.tool_ref === "tools/logger") {
    Logger.log(state);
    return { logged: true };
  }

  throw new Error("CGS_RUNTIME: Unknown tool -> " + node.tool_ref);
}

/**
 * GOVERNANCE NODE (deterministic policy enforcement)
 */
function runGovernanceNode(node, state) {

  const policy = node.policy_ref;

  // Minimal deterministic policy example
  if (policy === "governance/human_approval_v1.json") {

    const approved = checkApproval(state);

    return {
      approval_status: approved ? "APPROVED" : "DENIED"
    };
  }

  return { approval_status: "UNKNOWN_POLICY" };
}

/**
 * SIMPLE APPROVAL MOCK (replace with Gmail/Sheets webhook later)
 */
function checkApproval(state) {
  // deterministic placeholder:
  // in production: check Google Sheet / Form response / webhook flag
  return true;
}

/**
 * Resolve next node based on edges + conditions
 */
function resolveNextNode(workflow, currentNode, state) {

  const edges = workflow.edges || [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];

    if (e.from !== currentNode.id) continue;

    // unconditional transition
    if (!e.condition) return e.to;

    // evaluate condition safely
    if (evaluateCondition(e.condition, state)) {
      return e.to;
    }
  }

  return null;
}

/**
 * SAFE condition evaluator (NO eval)
 */
function evaluateCondition(condition, state) {

  // VERY minimal parser (expand later)
  // supports: state.reflection_score >= 0.85

  try {
    if (condition.includes(">=")) {
      const [left, right] = condition.split(">=");
      return getStateValue(state, left.trim()) >= parseFloat(right);
    }

    if (condition.includes("<")) {
      const [left, right] = condition.split("<");
      return getStateValue(state, left.trim()) < parseFloat(right);
    }

    if (condition.includes("==")) {
      const [left, right] = condition.split("==");
      return getStateValue(state, left.trim()) == right.trim().replace(/'/g, "");
    }

  } catch (e) {
    throw new Error("CGS_RUNTIME: Condition parse error -> " + condition);
  }

  return false;
}

/**
 * Reads state values like "state.x"
 */
function getStateValue(state, path) {
  return path.replace("state.", "").split(".")
    .reduce((acc, key) => acc && acc[key], state);
}

/**
 * Merge node outputs into state
 */
function stateMerge(state, result) {
  if (!result) return;
  Object.keys(result).forEach(k => state[k] = result[k]);
}

/**
 * Prompt builder
 */
function buildPrompt(node, state) {
  return JSON.stringify({
    node: node.id,
    inputs: node.inputs,
    state: state
  });
}

/**
 * Logging (replace with Sheets later)
 */
function logState(event, nodeId, state) {
  Logger.log(event + " :: " + nodeId + " :: " + JSON.stringify(state));
}
