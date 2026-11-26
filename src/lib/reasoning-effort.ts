const labels = {
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
} as const;
export type ReasoningEffort = keyof typeof labels;
export const reasoningLabel = (effort: ReasoningEffort) => labels[effort];

export function reasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  return Object.hasOwn(labels, key) ? key as ReasoningEffort : undefined;
}

type ModelCapabilities = {
  model: string;
  provider: string;
  declared_reasoning?: boolean;
  supported_reasoning_efforts?: ReasoningEffort[];
};
const aliases: Partial<Record<string, string>> = {
  azure: "azure_openai", azureopenai: "azure_openai", claude: "anthropic",
  google: "gemini", google_genai: "gemini",
  openai_compatible: "custom", anthropic_compatible: "custom_anthropic",
};
const openai = new Set(["openai", "azure_openai", "openai_codex", "github_copilot"]);
const binaryThinking = new Set(["deepseek", "volcengine", "volcengine_coding_plan",
  "byteplus", "byteplus_coding_plan", "dashscope", "minimax"]);
const common: ReasoningEffort[] = ["none", "low", "medium", "high"];

// Match the supported levels published by the v1.7.4 catalog, then use the
// known families in its composer. Unknown gateways can declare support.
export function reasoningLevels(option: ModelCapabilities | undefined): ReasoningEffort[] {
  if (!option || option.declared_reasoning === false) return [];
  if (option.supported_reasoning_efforts) return option.supported_reasoning_efforts;
  const binding = option.provider.trim().toLowerCase().replaceAll("-", "_");
  const provider = aliases[binding] || binding;
  const model = option.model.trim().toLowerCase();
  if (["minimax", "minimax_anthropic"].includes(provider)) {
    if (model === "minimax-m3.1-flash") return ["low", "medium", "high", "xhigh", "max"];
    if (model === "minimax-m3") return ["none"];
  }
  if (provider === "gemini" || model.includes("gemini")) {
    if (/gemini-3|gemini-2\.5-pro/.test(model)) return ["minimal", "low", "medium", "high"];
    if (model.includes("gemini-2.5")) return common;
    return ["low", "medium", "high"];
  }
  if (["anthropic", "custom_anthropic"].includes(provider) || model.includes("claude")) {
    if (/opus-4-[78]|opus-5|sonnet-5|fable-5|mythos-5/.test(model)) return ["none"];
    if (/claude-3-7|claude-4|claude-(sonnet|opus|haiku)-4/.test(model)) return common;
  } else if ((openai.has(provider) || ["custom", "zhipu"].includes(provider)) &&
      /(?:^|\/)glm-5\.3$/.test(model)) {
    return ["low", "high", "max"];
  } else if (binaryThinking.has(provider)) {
    if (provider === "minimax" || /deepseek-reasoner|deepseek-v4-pro|qwen-?3|qwq|qwen-plus/.test(model)) {
      return ["minimal", "high"];
    }
  } else if (openai.has(provider)) {
    if (model.includes("gpt-5.6-sol")) return ["none", "low", "medium", "high", "xhigh", "max"];
    if (/gpt-5|codex/.test(model)) return ["minimal", "low", "medium", "high", "xhigh"];
    if (/(?:^|\/)(o1|o3|o4)(?:$|-)/.test(model)) return ["low", "medium", "high"];
  }
  return option.declared_reasoning === true ? common : [];
}
