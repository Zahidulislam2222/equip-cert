'use client';

import { motion } from 'framer-motion';

interface TextRevealProps {
  text: string;
  className?: string;
  delay?: number;
  highlightWords?: string[];
  highlightClassName?: string;
}

export function TextReveal({
  text,
  className,
  delay = 0,
  highlightWords = [],
  highlightClassName = 'text-gradient',
}: TextRevealProps) {
  const words = text.split(' ');

  return (
    <motion.span
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.05, delayChildren: delay } },
      }}
      className={className}
    >
      {words.map((word, i) => {
        const isHighlight = highlightWords.includes(word.replace(/[.,!?]/g, ''));
        return (
          <motion.span
            key={`${word}-${i}`}
            variants={{
              hidden: { opacity: 0, y: 20, filter: 'blur(4px)' },
              visible: {
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
                transition: { type: 'spring', stiffness: 200, damping: 25 },
              },
            }}
            className={`inline-block mr-[0.3em] ${isHighlight ? highlightClassName : ''}`}
          >
            {word}
          </motion.span>
        );
      })}
    </motion.span>
  );
}
