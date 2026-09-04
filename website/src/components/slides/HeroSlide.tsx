import React from 'react'
import { config } from '../../config/presentation'

interface HeroSlideProps {
  onStartPresentation: () => void
  onOpenMobileApp: () => void
}

export const HeroSlide: React.FC<HeroSlideProps> = ({
  onStartPresentation,
  onOpenMobileApp,
}) => {
  return (
    <section className="slide snap-start relative flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-dorn-panel/20 to-transparent pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto text-center space-y-8 animate-fade-in">
        {/* Eyebrow */}
        <div className="text-xs sm:text-sm tracking-widest uppercase text-dorn-text-secondary font-medium">
          Universidad Católica · {new Date(config.event.date).toLocaleDateString('es-CL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>

        {/* Logo/Wordmark */}
        <div className="text-5xl sm:text-7xl md:text-8xl font-bold text-dorn-accent tracking-tight">
          DORN
        </div>

        {/* Main title */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-serif font-bold text-dorn-text leading-tight">
          Inteligencia que crea.
          <br />
          Tecnología que devuelve vida.
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg md:text-xl text-dorn-text-secondary max-w-2xl mx-auto leading-relaxed">
          Una plataforma de IA que transforma proyectos digitales y se extiende hacia máquinas reales mediante control local verificable.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
          <button
            onClick={onStartPresentation}
            className="btn btn-primary text-lg sm:text-base px-8 sm:px-6 py-4 sm:py-3 min-h-[56px] sm:min-h-[44px] w-full sm:w-auto"
            aria-label="Comenzar presentación"
          >
            Comenzar presentación
          </button>
          <button
            onClick={onOpenMobileApp}
            className="btn btn-secondary text-lg sm:text-base px-8 sm:px-6 py-4 sm:py-3 min-h-[56px] sm:min-h-[44px] w-full sm:w-auto"
            aria-label="Abrir piloto móvil"
          >
            Abrir piloto móvil
          </button>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
          <svg
            className="w-6 h-6 text-dorn-text-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      </div>
    </section>
  )
}
