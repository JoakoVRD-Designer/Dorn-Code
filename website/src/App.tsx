import { useState, useEffect } from 'react'
import { PresentationShell } from './components/PresentationShell'
import { HeroSlide } from './components/slides/HeroSlide'
import {
  ProblemSlide,
  SolutionSlide,
  EcosystemSlide,
  NanobubblesDemo,
  HardwareTruthSlide,
  ProductExperienceSlide,
  BusinessModelSlide,
  EvidenceMatrixSlide,
  ClosingSlide,
} from './components/slides/AllSlides'
import { MOBILE_APP_ROUTE } from './config/presentation'

const TOTAL_SLIDES = 10

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(0)

  // Handle hash-based navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      const slideNum = parseInt(hash) - 1
      if (slideNum >= 0 && slideNum < TOTAL_SLIDES) {
        setCurrentSlide(slideNum)
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange() // Initial check
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Update hash when slide changes
  useEffect(() => {
    window.location.hash = `#${currentSlide + 1}`
  }, [currentSlide])

  const handleSlideChange = (slide: number) => {
    setCurrentSlide(slide)
    window.location.hash = `#${slide + 1}`
  }

  const handleStartPresentation = () => {
    handleSlideChange(1)
  }

  const handleOpenMobileApp = () => {
    window.open(MOBILE_APP_ROUTE, '_blank')
  }

  const handleContactCTA = () => {
    const subject = 'Interés en DORN - Piloto de máquinas compatibles'
    const body = 'Quiero validar DORN con mi maquinaria...'
    window.location.href = `mailto:contacto@dormai.dev?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <PresentationShell
      currentSlide={currentSlide}
      totalSlides={TOTAL_SLIDES}
      onSlideChange={handleSlideChange}
    >
      {/* Slide 1: Hero */}
      <HeroSlide
        onStartPresentation={handleStartPresentation}
        onOpenMobileApp={handleOpenMobileApp}
      />

      {/* Slide 2: Problem */}
      <ProblemSlide />

      {/* Slide 3: Solution */}
      <SolutionSlide />

      {/* Slide 4: Ecosystem */}
      <EcosystemSlide />

      {/* Slide 5: Nanobubbles Demo */}
      <NanobubblesDemo />

      {/* Slide 6: Hardware Truth */}
      <HardwareTruthSlide />

      {/* Slide 7: Product Experience */}
      <ProductExperienceSlide />

      {/* Slide 8: Business Model */}
      <BusinessModelSlide />

      {/* Slide 9: Evidence Matrix */}
      <EvidenceMatrixSlide />

      {/* Slide 10: Closing */}
      <ClosingSlide
        onContactCTA={handleContactCTA}
        onMobileApp={handleOpenMobileApp}
      />
    </PresentationShell>
  )
}
