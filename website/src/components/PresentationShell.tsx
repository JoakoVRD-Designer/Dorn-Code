import React, { useState, useEffect, ReactNode } from 'react'
import { Menu, X } from 'lucide-react'

interface PresentationShellProps {
  children: ReactNode
  currentSlide: number
  totalSlides: number
  onSlideChange: (slide: number) => void
}

export const PresentationShell: React.FC<PresentationShellProps> = ({
  children,
  currentSlide,
  totalSlides,
  onSlideChange,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false)
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        onSlideChange(Math.min(currentSlide + 1, totalSlides - 1))
      }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        onSlideChange(Math.max(currentSlide - 1, 0))
      }
      if (e.key === 'Home') {
        e.preventDefault()
        onSlideChange(0)
      }
      if (e.key === 'End') {
        e.preventDefault()
        onSlideChange(totalSlides - 1)
      }
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentSlide, totalSlides, onSlideChange])

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (error) {
      console.error('Fullscreen error:', error)
    }
  }

  return (
    <div className="relative w-full h-screen bg-dorn-bg text-dorn-text overflow-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-dorn-bg/80 backdrop-blur-sm border-b border-dorn-panel">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold text-dorn-accent">DORN</div>

            <div className="hidden md:flex items-center gap-4">
              <span className="text-sm text-dorn-text-secondary">
                {currentSlide + 1} / {totalSlides}
              </span>
              <button
                onClick={toggleFullscreen}
                className="p-2 hover:bg-dorn-panel rounded-lg transition-colors"
                aria-label="Toggle fullscreen"
                title="Press F to toggle fullscreen"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 20v-4m0 4h4m-4 0l5-5m11 1v4m0-4h-4m4 0l-5-5"
                  />
                </svg>
              </button>
            </div>

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="md:hidden p-2 hover:bg-dorn-panel rounded-lg"
              aria-label="Toggle menu"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden bg-dorn-bg/95 backdrop-blur-sm pt-20">
          <div className="p-4 space-y-4">
            <div className="text-lg font-semibold">
              Sección {currentSlide + 1} de {totalSlides}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onSlideChange(i)
                    setIsMenuOpen(false)
                  }}
                  className={`p-3 rounded-lg text-sm font-medium transition-colors ${
                    i === currentSlide
                      ? 'bg-dorn-accent text-dorn-bg'
                      : 'bg-dorn-panel hover:bg-dorn-panel-secondary text-dorn-text'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="relative w-full h-screen overflow-y-scroll scroll-smooth snap-y snap-mandatory">
        {children}
      </main>

      {/* Navigation buttons */}
      <div className="fixed bottom-4 right-4 z-40 flex gap-2">
        <button
          onClick={() => onSlideChange(Math.max(currentSlide - 1, 0))}
          disabled={currentSlide === 0}
          className="p-3 bg-dorn-panel hover:bg-dorn-panel-secondary disabled:opacity-50 rounded-lg transition-colors"
          aria-label="Previous slide"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <button
          onClick={() => onSlideChange(Math.min(currentSlide + 1, totalSlides - 1))}
          disabled={currentSlide === totalSlides - 1}
          className="p-3 bg-dorn-panel hover:bg-dorn-panel-secondary disabled:opacity-50 rounded-lg transition-colors"
          aria-label="Next slide"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* Side navigation dots */}
      <div className="hidden lg:flex fixed right-4 top-1/2 transform -translate-y-1/2 z-40 flex-col gap-4">
        {Array.from({ length: totalSlides }).map((_, i) => (
          <button
            key={i}
            onClick={() => onSlideChange(i)}
            className={`w-3 h-3 rounded-full transition-all ${
              i === currentSlide
                ? 'bg-dorn-accent w-8'
                : 'bg-dorn-text-secondary hover:bg-dorn-text'
            }`}
            aria-label={`Go to slide ${i + 1}`}
            title={`Slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
