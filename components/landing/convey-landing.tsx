"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Code1, DocumentText, Flash, ShieldTick } from "@/components/icons";
import { BrandMark } from "@/components/site-header";
import productDesktop from "@/docs/screenshots/convey-app-desktop.png";

const MOMENTS = [
  ["01", "Scan or show", "Pay a merchant, collect from a friend, split a bill, or issue a limited pass from one QR workspace."],
  ["02", "Carry exact details", "The amount, person, purpose, and expiry travel inside the code when signal disappears."],
  ["03", "Reconnect and approve", "Your wallet remains the final authority. Every settled outcome produces a receipt you can check."],
] as const;

const REQUESTS = [
  { icon: Code1, text: "Pay River Cafe offline", meta: "Scan now, approve when connected" },
  { icon: DocumentText, text: "Split dinner with Maya, Idris, and Sam", meta: "Personal WhatsApp links ready" },
  { icon: ShieldTick, text: "Give Maya a grocery allowance", meta: "Purpose and expiry included" },
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
            <p className="companion-eyebrow text-white/52">QR payments built for unreliable signal</p>
            <h1>Pay by QR. Even when signal fails.</h1>
            <p className="landing-hero-lede">
              Scan, receive, split, or carry a payment offline. Reconnect once for wallet approval and a verifiable Sui receipt.
            </p>
            <div className="landing-hero-actions">
              <Link href="/qr-ferry" className="landing-primary-cta">
                Scan or show QR <ArrowRight size={17} />
              </Link>
              <Link href="/app" className="landing-secondary-cta">Ask Convey</Link>
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
          <h2>One QR can do more than checkout.</h2>
          <p>Use it to pay, collect, split, set a purpose limit, or carry a request between devices.</p>
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
          <p className="companion-eyebrow text-black/45">Offline QR, built into every money task</p>
          <h2 id="landing-handoff-title">The code carries the agreement.</h2>
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
          <h2>Scan first. Ask when you need more.</h2>
          <p>QR handles the handoff. Convey&apos;s companion remembers people, turns receipt photos into requests, and prepares bounded actions for review.</p>
          <Link href="/qr-ferry" className="landing-stage-link">Create a payment code <ArrowRight size={17} /></Link>
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
          <h2>Clear before clever.</h2>
        </motion.div>
        <div className="landing-proof-grid">
          <div><ShieldTick size={20} /><strong>Guarded intent</strong><p>AI prepares a bounded action. It never becomes wallet authority.</p></div>
          <div><Flash size={20} /><strong>Offline-ready QR</strong><p>Install on mobile or desktop and carry exact payment details through weak connectivity.</p></div>
          <div><DocumentText size={20} /><strong>Receipts that explain</strong><p>See what was requested, checked, approved, and settled.</p></div>
        </div>
      </section>

      <section className="landing-final-cta">
        <BrandMark size={34} />
        <h2>What should this QR do?</h2>
        <p>Pay, collect, split, or set a limit.</p>
        <Link href="/qr-ferry" className="landing-primary-cta">Open QR payments <ArrowRight size={17} /></Link>
      </section>
    </div>
  );
}
