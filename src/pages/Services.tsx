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
      <Seo
        title="Services: web3 development"
        description="Gully Labs builds for other teams: L2/L3 chain launch, smart contracts, security reviews and monitoring, dApp/web/mobile apps, payments, RPC and infrastructure, token launch and quests, AI integration and Unity game development."
      />
      <section className="gt-hero gt-phero" aria-labelledby="s-h">
        <div className="gt-wrap gt-one">
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
          </div>
          <div className="rv">
            <ContactForm />
          </div>
        </div>
      </section>
    </div>
  )
}
