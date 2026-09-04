"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, DocumentText, Flash, People, ShieldTick } from "@/components/icons";
import { BrandMark } from "@/components/site-header";
import productDesktop from "@/docs/screenshots/convey-app-desktop.png";

const MOMENTS = [
  ["01", "Describe the outcome", "Speak or type what should happen. Convey remembers people, understands receipts, and keeps the original request intact."],
  ["02", "Let agents interpret", "Gonka agents map the request. Deterministic policy checks the recipient, amount, purpose, expiry, and evidence rules."],
  ["03", "Approve the agreement", "Your wallet signs the exact terms. Sui enforces release or refund, then Convey produces a receipt anyone can verify."],
] as const;

const REQUESTS = [
  { icon: People, text: "Send Dave 12 USDC for dinner", meta: "Known person, exact intent" },
  { icon: DocumentText, text: "Split this receipt with Maya and Sam", meta: "Personal requests and QR links" },
  { icon: ShieldTick, text: "Protect 500 USDC overnight", meta: "Bounded strategy, approval required" },
] as const;

export function ConveyLanding() {
  const reduceMotion = useReducedMotion();
  const reveal = reduceMotion
    ? {}
    : {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, amount: 0.22 },
        transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-media" aria-hidden>
          {reduceMotion ? (
            <Image src="/media/convey-intent-poster.webp" alt="" fill priority sizes="100vw" />
          ) : (
            <video autoPlay muted loop playsInline poster="/media/convey-intent-poster.webp">
              <source src="/media/convey-intent-route.webm" type="video/webm" />
              <source src="/media/convey-intent-route.mp4" type="video/mp4" />
            </video>
          )}
        </div>
        <div className="landing-hero-grid">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, transform: "translateY(20px)" }}
            animate={{ opacity: 1, transform: "translateY(0)" }}
            transition={{ duration: reduceMotion ? 0 : 0.72, ease: [0.22, 1, 0.36, 1] }}
            className="landing-hero-copy"
          >
            <p className="companion-eyebrow text-white/52">Protected intent, powered by Sui</p>
            <h1>Describe the outcome.</h1>
            <p className="landing-hero-lede">
              Convey turns natural language into an enforceable Sui agreement. AI interprets. Policy checks. You approve. The chain decides release or refund.
            </p>
            <div className="landing-hero-actions">
              <Link href="/app" className="landing-primary-cta">
                Ask Convey <ArrowRight size={17} />
              </Link>
              <Link href="/qr-ferry" className="landing-secondary-cta">Scan or show QR</Link>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, transform: "translateX(30px) rotate(1.5deg)" }}
            animate={{ opacity: 1, transform: "translateX(0) rotate(0deg)" }}
            transition={{ duration: reduceMotion ? 0 : 0.85, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="landing-product-frame"
          >
            <Image
              src={productDesktop}
              alt="Convey assistant preparing a receipt split in the real product"
              priority
              sizes="(max-width: 900px) 92vw, 52vw"
            />
          </motion.div>
        </div>
      </section>

      <section id="how-it-works" className="landing-story">
        <motion.div {...reveal} className="landing-story-intro">
          <h2>One request. Exact terms. Public proof.</h2>
          <p>The request, agent run, policy result, payment terms, evidence rules, reviewer, and expiry resolve into one agreement hash.</p>
        </motion.div>
        <div className="landing-moment-grid">
          {MOMENTS.map(([number, title, body], index) => (
            <motion.article key={number} {...reveal} transition={reduceMotion ? undefined : { duration: 0.55, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}>
              <span>{number}</span><h3>{title}</h3><p>{body}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="landing-handoff" aria-labelledby="landing-handoff-title">
        <motion.div {...reveal} className="landing-handoff-copy">
          <p className="companion-eyebrow text-black/45">When a code is the easiest way</p>
          <h2 id="landing-handoff-title">Carry the request by QR.</h2>
          <p>
            Amount, recipient, purpose, and expiry stay together. Send a personal split link on WhatsApp, show a merchant code, or pass a request to another device.
          </p>
          <Link href="/qr-ferry" className="landing-handoff-link">
            Open QR payments <ArrowRight size={17} />
          </Link>
        </motion.div>
        <motion.div {...reveal} className="landing-handoff-flow" aria-label="A payment request moving between two devices">
          <article className="landing-device-card">
            <span className="landing-device-status">Dinner split</span>
            <strong>Maya owes 12.43 USDC</strong>
            <small>Personal QR and WhatsApp link</small>
            <div><span>Request ready</span><ShieldTick size={17} /></div>
          </article>
          <div className="landing-transfer-pulse" aria-hidden>
            <span><Flash size={18} /></span>
            <i />
            <b>Scan</b>
          </div>
          <article className="landing-device-card landing-device-card--dark">
            <span className="landing-device-status">Maya&apos;s phone</span>
            <strong>Review 12.43 USDC</strong>
            <small>Dinner share, recipient, and expiry checked</small>
            <div><span>Ready for wallet approval</span><ArrowRight size={17} /></div>
          </article>
        </motion.div>
      </section>

      <section className="landing-stage">
        <motion.div {...reveal} className="landing-stage-copy">
          <h2>Your companion, backed by careful agents.</h2>
          <p>Ask naturally. Convey remembers who people are, understands receipt splits, checks risk, and prepares bounded actions without taking wallet control.</p>
          <Link href="/app" className="landing-stage-link">Start a conversation <ArrowRight size={17} /></Link>
        </motion.div>
        <motion.div {...reveal} className="landing-request-stack">
          {REQUESTS.map(({ icon: Icon, text, meta }, index) => (
            <motion.div
              key={text}
              initial={reduceMotion ? false : { opacity: 1, transform: "translateX(18px)" }}
              whileInView={{ opacity: 1, transform: "translateX(0)" }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: reduceMotion ? 0 : 0.5, delay: index * 0.1 }}
              className="landing-request-card"
            >
              <span><Icon size={19} /></span><div><strong>{text}</strong><small>{meta}</small></div><ArrowRight size={16} />
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section className="landing-proof">
        <motion.div {...reveal}>
          <h2>AI proposes. Sui enforces.</h2>
        </motion.div>
        <div className="landing-proof-grid">
          <div><ShieldTick size={20} /><strong>Intent bound to contract</strong><p>The original request and Gonka run become part of the private agreement artifact. Its digest is anchored in the Sui object.</p></div>
          <div><Flash size={20} /><strong>QR crosses the gap</strong><p>QR carries the exact request across weak connectivity. A connected wallet still approves; Sui performs final settlement.</p></div>
          <div><DocumentText size={20} /><strong>Public lifecycle proof</strong><p>Follow creation, evidence review, release or refund, and an independently verified receipt from the normal product flow.</p></div>
        </div>
      </section>

      <section className="landing-final-cta">
        <BrandMark size={34} />
        <h2>Make the outcome enforceable.</h2>
        <p>Speak, type, scan, or share a receipt. Convey prepares the agreement; you approve it.</p>
        <Link href="/app" className="landing-primary-cta">Ask Convey <ArrowRight size={17} /></Link>
      </section>
    </div>
  );
}
