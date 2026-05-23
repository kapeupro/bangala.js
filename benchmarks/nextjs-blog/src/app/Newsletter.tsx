"use client";

import { useState } from "react";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      className="newsletter"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <label htmlFor="nl-email">Sign up for the newsletter</label>
      <input
        id="nl-email"
        type="email"
        placeholder="you@example.com"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={submitted}>
        Subscribe
      </button>
      <p className="nl-msg" aria-live="polite">
        {submitted ? `Thanks, ${email}!` : ""}
      </p>
    </form>
  );
}
