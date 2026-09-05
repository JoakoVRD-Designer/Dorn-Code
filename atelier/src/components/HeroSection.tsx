import { useEffect, useState } from 'react'
import { ArrowRight, Play } from 'lucide-react'

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_204103_f607742e-09da-4cf5-bb06-4e67b0a531de.mp4'

const NAV_LINKS = ['Projects', 'Expertise', 'Studio', 'Insights']
const MOBILE_LINKS = [...NAV_LINKS, 'Reach Out']

/**
 * Three-line mark that morphs into an X. Rendered twice: once as the navbar
 * hamburger, once as the overlay's close button.
 */
function MenuToggle({
  isOpen,
  onClick,
  label,
}: {
  isOpen: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="md:hidden p-2 -mr-2"
      aria-label={label}
      aria-expanded={isOpen}
      aria-controls="mobile-menu"
    >
      <span className="relative block w-6 h-6">
        <span
          className="absolute left-0 top-1/2 -mt-px h-[2px] w-6 rounded-full bg-white transition-transform duration-500 ease-menu"
          style={{ transform: isOpen ? 'rotate(45deg)' : 'translateY(-6px)' }}
        />
        <span
          className="absolute right-0 top-1/2 -mt-px h-[2px] w-4 rounded-full bg-white transition-opacity duration-500 ease-menu"
          style={{ opacity: isOpen ? 0 : 1 }}
        />
        <span
          className="absolute left-0 top-1/2 -mt-px h-[2px] w-6 rounded-full bg-white transition-transform duration-500 ease-menu"
          style={{ transform: isOpen ? 'rotate(-45deg)' : 'translateY(6px)' }}
        />
      </span>
    </button>
  )
}

export default function HeroSection() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  return (
    <section className="relative w-full h-screen overflow-hidden">
      <video
        className="absolute inset-0 w-full h-full object-cover"
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      {/* Keeps white copy legible over arbitrary video frames. */}
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />

      <div className="relative z-10 flex flex-col h-full">
        <nav className="flex items-center justify-between px-6 md:px-12 lg:px-16 py-5 md:py-6">
          <div className="flex items-center gap-10">
            <span className="font-sans text-lg font-semibold tracking-tight text-white">
              Atelier
            </span>
            <div className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((label) => (
                <a
                  key={label}
                  href="#"
                  className="text-sm font-light text-white/80 hover:text-white transition-colors duration-200"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="#"
              className="hidden md:block text-sm font-light text-white/80 hover:text-white transition-colors duration-200"
            >
              Reach Out
            </a>
            <button
              type="button"
              className="hidden md:block rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-white/90 transition-colors duration-200"
            >
              Let's Talk
            </button>
            <MenuToggle
              isOpen={isOpen}
              onClick={() => setIsOpen(true)}
              label="Open menu"
            />
          </div>
        </nav>

        <div className="flex-1 flex flex-col items-center justify-start pt-4 sm:pt-6 md:pt-8 lg:pt-10 px-6 text-center">
          <h1 className="font-instrument-serif text-white text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl leading-[1.1] max-w-5xl">
            UX <span className="italic font-instrument-serif">and</span> APP
            <br />
            DESIGN <span className="italic font-instrument-serif">for</span> BOLD
            <br />
            VENTURES
          </h1>

          <p className="mt-4 md:mt-5 text-white/70 text-sm md:text-base font-light max-w-md leading-relaxed">
            We shape digital products that define brands
            <br className="hidden sm:block" /> and unlock exponential growth.
          </p>

          <div className="mt-5 md:mt-6 flex flex-col sm:flex-row items-center gap-4">
            <button
              type="button"
              className="group flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-medium text-black hover:bg-white/90 transition-colors duration-200"
            >
              See Cases
              <ArrowRight
                size={16}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border border-white/40 px-7 py-3 text-sm font-medium text-white hover:bg-white/10 hover:border-white/60 transition-colors duration-200"
            >
              <Play size={16} />
              Watch Reel
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu overlay */}
      <div
        id="mobile-menu"
        className={`fixed inset-0 z-50 md:hidden ${isOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!isOpen}
      >
        <div
          className={`absolute inset-0 bg-black/90 backdrop-blur-xl transition-opacity duration-700 ease-menu ${
            isOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <div
          className={`relative flex flex-col h-full transition-opacity duration-700 ease-menu ${
            isOpen ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <span className="font-sans text-lg font-semibold tracking-tight text-white">
              Atelier
            </span>
            <MenuToggle
              isOpen={isOpen}
              onClick={() => setIsOpen(false)}
              label="Close menu"
            />
          </div>

          <nav className="flex-1 flex flex-col justify-center px-6">
            <ul>
              {MOBILE_LINKS.map((label, i) => (
                <li
                  key={label}
                  className={`transition-all duration-700 ease-menu ${
                    isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                  }`}
                  style={{ transitionDelay: isOpen ? `${150 + i * 80}ms` : '0ms' }}
                >
                  <a
                    href="#"
                    tabIndex={isOpen ? 0 : -1}
                    onClick={() => setIsOpen(false)}
                    className="block border-b border-white/10 py-4 font-instrument-serif text-4xl sm:text-5xl text-white hover:pl-4 transition-[padding] duration-500 ease-menu"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div
            className={`px-6 pb-10 transition-all duration-700 ease-menu ${
              isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
            style={{ transitionDelay: isOpen ? '550ms' : '0ms' }}
          >
            <button
              type="button"
              tabIndex={isOpen ? 0 : -1}
              className="w-full rounded-full bg-white py-4 text-sm font-medium text-black"
            >
              Let's Talk
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
