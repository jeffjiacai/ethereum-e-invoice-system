import React from "react";

export default function Msg({ msg }) {
  if (!msg) return null;
  return <div className={`msg ${msg.kind}`}>{msg.text}</div>;
}
