import { ArrowRight } from 'lucide-react'
import { Seo } from '../components/Seo'
import '../terminal/terminal.css'
import { SERVICES } from '../terminal/catalog'
import { SecHead, useReveal } from '../terminal/kit'
import { CaseStudies, ContactForm, Process, ServicesList } from '../terminal/sections'

/* /services, landing v3 (2026-10-26): every service we sell to other teams (description, deliverables, typical
   timeline, the Gully product that proves it, "Start a project"), the case studies, the process and the intake
   form. /services?service=<key>#contact preselects a project type. */
export function Services() {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div className="lcp gt" ref={ref}>
      <Seo page="/services" />
      <section className="gt-hero gt-phero" aria-labelledby="s-h">
        <div className="gt-wrap">
          <div className="gt-hero-copy rise">
            <span className="gt-k">
              <b>services</b> · {SERVICES.length} practices · one team
            </span>
            <h1 id="s-h">
              Web3 development, <span className="gt-acc">shipped.</span>
            </h1>
            <p className="gt-lede">Chains, contracts, apps, payments, infrastructure, AI and games, built by the team that runs Gully Chain, Gully Pay, Gully RPC and Gully Security in production.</p>
            <div className="gt-ctas">
              <a className="gt-btn pri" href="#contact">
                Start a project
                <ArrowRight className="gt-ic" aria-hidden />
              </a>
              <a className="gt-btn sec" href="#work">
                See the proof
              </a>
            </div>
          </div>
          {/* The hero's second column (design round 4): every practice with its typical timeline, one tap to brief us. */}
          <aside className="gt-hero-aside rise" aria-label="Practices and timelines">
            <span className="gt-k"><b>practices</b> · typical timelines</span>
            <ul>
              {SERVICES.slice(0, 6).map((s) => (
                <li key={s.key}>
                  <a href={`?service=${s.key}#contact`}>
                    <b>{s.title}</b>
                    <span>{s.timeline}</span>
                  </a>
                </li>
              ))}
            </ul>
            {SERVICES.length > 6 && <a className="gt-more" href="#services-h">All {SERVICES.length} practices</a>}
          </aside>
        </div>
      </section>
      <section className="gt-sec" aria-labelledby="services-h">
        <div className="gt-wrap">
          <SecHead n="01" label="Services" title="What we build for you" id="services-h" />
          <ServicesList />
        </div>
      </section>
      <section id="work" className="gt-sec" aria-labelledby="work-h">
        <div className="gt-wrap">
          <SecHead n="02" label="Case studies" title="Our products are the proof" id="work-h" />
          <CaseStudies />
        </div>
      </section>
      <section className="gt-sec" aria-labelledby="process-h">
        <div className="gt-wrap">
          <SecHead n="03" label="Process" title="Discover. Build. Launch. Grow." id="process-h" />
          <Process />
        </div>
      </section>
      <section id="contact" className="gt-sec gt-contact" aria-labelledby="contact-h">
        <div className="gt-wrap">
          <div className="gt-contact-copy rv">
            <SecHead n="04" label="Contact" title="Tell us what you are building" id="contact-h">
              A short brief is enough. We answer with questions or a first scope.
            </SecHead>
            <ol className="gt-next">
              <li><b>Within two working days</b><span>A reply from the team that would build it, with questions or a first scope.</span></li>
              <li><b>A short call if it helps</b><span>Thirty minutes on goals, chains, timeline and budget.</span></li>
              <li><b>A written proposal</b><span>Deliverables, timeline and price, before any work starts.</span></li>
            </ol>
            <p className="gt-next-mail">Rather write? <a href="mailto:team@gullylabs.xyz">team@gullylabs.xyz</a></p>
          </div>
          <div className="rv">
            <ContactForm />
          </div>
        </div>
      </section>
    </div>
  )
}
