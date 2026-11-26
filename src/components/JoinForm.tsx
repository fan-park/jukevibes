"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length >= 4) router.push(`/r/${clean}`);
      }}
    >
      <input
        className="input code-input"
        placeholder="CODE"
        value={clean}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        inputMode="text"
        aria-label="Session code"
      />
      <button className="btn block" disabled={clean.length < 4}>
        Join
      </button>
    </form>
  );
}
