'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  id: string
  label: string
  description?: string
}

interface StepperProps {
  steps: Step[]
  currentStep: number   // 0-indexed
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function Stepper({ steps, currentStep, orientation = 'horizontal', className }: StepperProps) {
  const isVertical = orientation === 'vertical'

  return (
    <div className={cn(
      isVertical ? 'flex flex-col gap-0' : 'flex items-center',
      className
    )}>
      {steps.map((step, i) => {
        const done    = i < currentStep
        const active  = i === currentStep
        const pending = i > currentStep
        const isLast  = i === steps.length - 1

        return (
          <div key={step.id} className={cn(
            isVertical ? 'flex gap-4' : 'flex items-center',
            !isLast && !isVertical && 'flex-1'
          )}>
            {/* Circle + connector (vertical) */}
            {isVertical && (
              <div className="flex flex-col items-center">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border-2 transition-all',
                  done    && 'bg-halqa-700 border-halqa-700 text-white',
                  active  && 'bg-white border-halqa-700 text-halqa-700',
                  pending && 'bg-white border-gray-300 text-gray-400'
                )}>
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                {!isLast && <div className={cn('w-0.5 flex-1 min-h-[24px] my-1', done ? 'bg-halqa-700' : 'bg-gray-200')} />}
              </div>
            )}

            {/* Circle (horizontal) */}
            {!isVertical && (
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border-2 transition-all',
                done    && 'bg-halqa-700 border-halqa-700 text-white',
                active  && 'bg-white border-halqa-700 text-halqa-700',
                pending && 'bg-white border-gray-300 text-gray-400'
              )}>
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
            )}

            {/* Label */}
            <div className={cn(isVertical ? 'pb-6' : 'hidden md:block ml-2')}>
              <p className={cn('text-sm font-medium', active ? 'text-halqa-700' : done ? 'text-gray-900' : 'text-gray-400')}>
                {step.label}
              </p>
              {step.description && (
                <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>
              )}
            </div>

            {/* Connector line (horizontal) */}
            {!isVertical && !isLast && (
              <div className={cn('flex-1 h-0.5 mx-3', i < currentStep ? 'bg-halqa-700' : 'bg-gray-200')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
