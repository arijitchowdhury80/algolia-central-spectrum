/**
 * The active instance for this build of the app, plus its skin. This is the
 * ONE file that wires a concrete instance + theme together — swapping to a
 * different `Algolia-Central-[Company]` instance means changing the two
 * lines below (or, per Part 2, generating this file via new-instance.mjs).
 */
import spectrumInstance from './instances/spectrum';
// Algolia × Adobe cobrand: Algolia design language (Sora, Nebula Blue, Algolia
// tokens) over the Adobe Spectrum corpus/brand. See themes/algolia-adobe.css.
import '../themes/algolia-adobe.css';

export const activeInstance = spectrumInstance;
