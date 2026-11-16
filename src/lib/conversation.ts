import type { TurnEvent } from "./client";
export function visibleMessage(message: { role: string; content: string; events?: TurnEvent[]; attachments?: unknown[] }, active = false) {
  return message.role !== "assistant" || active || !!message.content.trim() || !!message.attachments?.length ||
    !!message.events?.some(e => ["result", "tool_result"].includes(e.type) && e.metadata && Object.keys(e.metadata).length > 0);
}
export function cancelledTurn(event: TurnEvent) {
  return event.type === "error" && /^Turn cancel(?:l)?ed\.?$/i.test(event.content?.trim() || "");
}
export function conversationTitle(title:string){return /^(New conversation|New chat|New reading conversation)$/i.test(title)?"学习对话":title||"学习对话";}
// Display only: never write this shortened label back to a session or rename form.
export function compactConversationTitle(title: string, limit = 16) {
  const full = conversationTitle(title.replace(/\s+/g, " ").trim());
  const characters = Array.from(full);
  return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : full;
}
export function dialogueParts(content:string,events:TurnEvent[]=[]):{role:"assistant"|"user";text:string}[]{
  const parts:{role:"assistant"|"user";text:string}[]=[];let offset=0;
  for(const event of events){const meta=event.metadata;if(!meta?.ask_user_resolved)continue;
    const value=Number(meta.assistant_content_offset);const boundary=Number.isFinite(value)?Math.max(offset,Math.min(content.length,value)):offset;
    if(boundary>offset)parts.push({role:"assistant",text:content.slice(offset,boundary)});
    offset=boundary;const answers=Array.isArray(meta.answers)?meta.answers:[];
    const reply=answers.map(a=>a&&typeof a==="object"&&"text" in a?String(a.text):"").filter(Boolean).join("\n");
    const text=reply||(typeof meta.reply_preview==="string"?meta.reply_preview:"");if(text)parts.push({role:"user",text});
  }
  if(offset<content.length)parts.push({role:"assistant",text:content.slice(offset)});return parts;
}
