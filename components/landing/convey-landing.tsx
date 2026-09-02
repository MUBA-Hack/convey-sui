"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, DocumentText, Flash, MoneyRecive, ShieldTick } from "@/components/icons";
import { BrandMark } from "@/components/site-header";
import productDesktop from "@/docs/screenshots/convey-app-desktop.png";

const MOMENTS = [
  ["01", "Say it naturally", "Ask by voice or text. Convey remembers the people and context that make a request meaningful."],
  ["02", "Review one clear move", "Recipient, amount, evidence, limits, and risk checks arrive together before anything can move."],
  ["03", "Approve, then prove", "Your wallet remains the final authority and the resulting receipt can be checked independently."],
] as const;

const REQUESTS = [
  { icon: MoneyRecive, text: "Send Dave 12 USDC", meta: "Dinner · ready to review" },
  { icon: DocumentText, text: "Split this receipt", meta: "4 people · 10.35 USDC" },
  { icon: ShieldTick, text: "Protect my overnight balance", meta: "Spend and loss limits set" },
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
            <p className="companion-eyebrow text-white/52">Money that understands the assignment</p>
            <h1>Say what should happen.</h1>
            <p className="landing-hero-lede">
              Pay a friend, split a receipt, or protect a treasury. Start with one natural conversation and keep going when the connection changes.
            </p>
            <div className="landing-hero-actions">
              <Link href="/app" className="landing-primary-cta">
                Open Convey <ArrowRight size={17} />
              </Link>
              <a href="#how-it-works" className="landing-secondary-cta">See how it works</a>
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
          <h2>Your financial life, without the financial interface.</h2>
          <p>Convey keeps complexity behind the conversation and the important decision in front of you.</p>
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
          <p className="companion-eyebrow text-black/45">One request · any device</p>
          <h2 id="landing-handoff-title">Start here. Finish anywhere.</h2>
          <p>
            Prepare the payment in conversation. If signal or battery becomes the problem,
            carry that same review to another device and approve only after you reconnect.
          </p>
          <Link href="/pay" className="landing-handoff-link">
            Send money <ArrowRight size={17} />
          </Link>
        </motion.div>
        <motion.div {...reveal} className="landing-handoff-flow" aria-label="A payment request moving between two devices">
          <article className="landing-device-card">
            <span className="landing-device-status">Phone · prepared</span>
            <strong>Send Ana RM500</strong>
            <small>School supplies · family limit RM520</small>
            <div><span>Review ready</span><ShieldTick size={17} /></div>
          </article>
          <div className="landing-transfer-pulse" aria-hidden>
            <span><Flash size={18} /></span>
            <i />
            <b>Carry</b>
          </div>
          <article className="landing-device-card landing-device-card--dark">
            <span className="landing-device-status">Laptop · reconnected</span>
            <strong>Same request</strong>
            <small>Recipient, amount and limit checked again</small>
            <div><span>Ready for wallet approval</span><ArrowRight size={17} /></div>
          </article>
        </motion.div>
      </section>

      <section className="landing-stage">
        <motion.div {...reveal} className="landing-stage-copy">
          <h2>From a thought to a trustworthy outcome.</h2>
          <p>Pay, split, protect, or collect. Each request becomes a reviewable move with hard limits and a durable receipt.</p>
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
          <h2>Clear before clever.</h2>
        </motion.div>
        <div className="landing-proof-grid">
          <div><ShieldTick size={20} /><strong>Guarded intent</strong><p>AI prepares a bounded action. It never becomes wallet authority.</p></div>
          <div><Flash size={20} /><strong>Carry it anywhere</strong><p>Install on mobile or desktop and continue a request when connectivity changes.</p></div>
          <div><DocumentText size={20} /><strong>Receipts that explain</strong><p>See what was requested, checked, approved, and settled.</p></div>
        </div>
      </section>

      <section className="landing-final-cta">
        <BrandMark size={34} />
        <h2>What should happen?</h2>
        <p>Tell Convey in your own words.</p>
        <Link href="/app" className="landing-primary-cta">Open Convey <ArrowRight size={17} /></Link>
      </section>
    </div>
  );
}
