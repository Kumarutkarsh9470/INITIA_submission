// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
library GaussianMath {
 uint256 internal constant WAD = 1e18;
 // Normal CDF approximation using Abramowitz and Stegun.
 // Input x is a signed integer in WAD notation.
 // Returns a value between 0 and 1e18 representing a probability.
 function normalCDF(int256 x_wad) internal pure returns (uint256) {
 // Work with the absolute value. We will flip at the end if x < 0.
 uint256 ax = x_wad >= 0
 ? uint256(x_wad)
 : uint256(-x_wad);
 // Coefficients scaled by 1e18 for the polynomial.
 // These come directly from Abramowitz and Stegun table 26.2.17
 uint256 p = 231641900000000000; // 0.2316419 * 1e18
 uint256 b1 = 319381530000000000; // 0.319381530 * 1e18
 uint256 b2 = 356563782000000000; // 0.356563782 * 1e18 (negative sign applied below)
 uint256 b3 = 1781477937000000000; // 1.781477937 * 1e18
 uint256 b4 = 1821255978000000000; // 1.821255978 * 1e18 (negative sign applied below)
 uint256 b5 = 1330274429000000000; // 1.330274429 * 1e18
 // t = 1 / (1 + p * |x|)
 uint256 denom = WAD + (p * ax / WAD);
 uint256 t = (WAD * WAD) / denom;
 // Horner's method: polynomial in t
 // poly = b5*t^5 - b4*t^4 + b3*t^3 - b2*t^2 + b1*t
 uint256 t2 = t * t / WAD;
 uint256 t3 = t2 * t / WAD;
 uint256 t4 = t3 * t / WAD;
 uint256 t5 = t4 * t / WAD;
 // Note the alternating signs
 uint256 poly;
 {
 uint256 pos = b1 * t / WAD + b3 * t3 / WAD + b5 * t5 / WAD;
 uint256 neg = b2 * t2 / WAD + b4 * t4 / WAD;
 poly = pos > neg ? pos - neg : 0;
 }
 // Multiply by phi(x) -- use a simplified constant for the bell curve
 // phi(0) = 0.3989422... We use a pre-computed approximation here
 uint256 phix = _normalPDF(ax);
 uint256 tail = poly * phix / WAD;
 // CDF(|x|) = 1 - tail
 uint256 cdf_abs = tail <= WAD ? WAD - tail : 0;
 // Flip if x was negative: CDF(-x) = 1 - CDF(x)
 if (x_wad < 0) {
 return WAD - cdf_abs;
 }
 return cdf_abs;
 }
 // Normal PDF: phi(x) = (1/sqrt(2*pi)) * exp(-x^2/2)
 // Approximated using integer exp via Taylor series.
 // Input ax is the absolute value of x in WAD notation.
 function _normalPDF(uint256 ax) internal pure returns (uint256) {
 // Compute -x^2 / 2 as a positive exponent argument then negate
 // If ax > 9e18 (9.0 in real terms) the PDF is essentially 0
 if (ax > 9 * WAD) return 0;
 uint256 x2 = ax * ax / WAD; // x^2 in WAD
 uint256 exp_arg = x2 / 2; // x^2 / 2 in WAD
 // exp(-z) via Taylor: 1 - z + z^2/2! - z^3/3! + ... (6 terms)
 uint256 z = exp_arg;
 uint256 z2 = z * z / WAD;
 uint256 z3 = z2 * z / WAD;
 uint256 z4 = z3 * z / WAD;
 uint256 z5 = z4 * z / WAD;
 uint256 z6 = z5 * z / WAD;
 // Sum positive and negative terms separately to avoid underflow
 uint256 pos = WAD + z2 / 2 + z4 / 24 + z6 / 720;
 uint256 neg = z + z3 / 6 + z5 / 120;
 uint256 expNeg = pos > neg ? pos - neg : 0;
 // Multiply by 1/sqrt(2*pi) = 0.3989422... in WAD
 return expNeg * 398942280000000000 / WAD;
 }
 // Public wrapper so pmAMM can call normalPDF directly
 function normalPDF(int256 x_wad) internal pure returns (uint256) {
 uint256 ax = x_wad >= 0
 ? uint256(x_wad)
 : uint256(-x_wad);
 return _normalPDF(ax);
 }
}
