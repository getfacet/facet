import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { COLOR } from "./theme.js";

export interface ChatMessage {
  /** Who said it — e.g. "You" or the agent's name. */
  readonly who: string;
  readonly text: string;
}

export interface ChatDockProps {
  readonly messages: readonly ChatMessage[];
  readonly onSend: (text: string) => void;
  /** Show a "thinking" line while the agent works. */
  readonly pending?: boolean;
  readonly placeholder?: string;
}

/**
 * The persistent chat dock — the visitor's control surface for driving the
 * Stage. It is deliberately NOT part of the agent-generated stage: it's stable
 * app chrome that turns a visitor's typing into `message` events. Presentational
 * — the parent owns the message list and handles `onSend`.
 */
export function ChatDock({
  messages,
  onSend,
  pending = false,
  placeholder = "Type a message…",
}: ChatDockProps): ReactNode {
  const [draft, setDraft] = useState("");

  const submit = (): void => {
    const text = draft.trim();
    if (text === "") return;
    onSend(text);
    setDraft("");
  };

  return (
    <div style={styles.dock}>
      <div style={styles.log}>
        {messages.map((message, index) => (
          <div key={index} style={styles.line}>
            <span style={styles.who}>{message.who}:</span> {message.text}
          </div>
        ))}
        {pending ? <div style={styles.pending}>…</div> : null}
      </div>
      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <button style={styles.send} type="button" onClick={submit}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  dock: {
    border: `1px solid ${COLOR.border}`,
    borderRadius: "12px",
    overflow: "hidden",
    background: COLOR.surface,
  },
  log: {
    maxHeight: "140px",
    overflowY: "auto",
    padding: "10px 14px",
    fontSize: "13px",
    color: COLOR.fg,
  },
  line: { marginBottom: "4px" },
  who: { fontWeight: 600, color: COLOR.accent },
  pending: { color: COLOR["fg-muted"], fontStyle: "italic" },
  inputRow: {
    display: "flex",
    gap: "8px",
    padding: "10px 14px",
    borderTop: `1px solid ${COLOR["surface-2"]}`,
  },
  input: {
    flex: 1,
    padding: "8px 10px",
    borderRadius: "8px",
    border: `1px solid ${COLOR.border}`,
    fontFamily: "inherit",
    fontSize: "14px",
  },
  send: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: COLOR.accent,
    color: COLOR["accent-fg"],
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  },
};
