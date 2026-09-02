// Deteksi industri otomatis berbasis keyword matching (100% gratis, jalan
// lokal tanpa API berbayar apapun). Setiap kategori punya daftar kata kunci
// (Indonesia + Inggris) yang biasa muncul di job title/description/requirement
// untuk industri tsb. Skor dihitung dari jumlah kemunculan kata kunci, lalu
// kategori dengan skor tertinggi yang dipilih.

const CATEGORIES = [
  {
    name: 'Beauty, Cosmetics & Wellness',
    keywords: [
      'beauty clinic', 'beauty', 'klinik kecantikan', 'kecantikan', 'cosmetic',
      'kosmetik', 'skincare', 'skin care', 'aesthetic clinic', 'klinik estetika',
      'spa', 'salon', 'dermatology', 'wellness', 'personal care',
    ],
  },
  {
    name: 'Fashion & Apparel',
    keywords: [
      'fashion', 'apparel', 'garment', 'garmen', 'textile', 'tekstil',
      'clothing', 'pakaian', 'footwear', 'sepatu', 'boutique',
    ],
  },
  {
    name: 'Retail & FMCG',
    keywords: [
      'retail', 'ritel', 'fmcg', 'consumer goods', 'supermarket', 'minimarket',
      'department store', 'merchandising', 'consumer product', 'toko',
    ],
  },
  {
    name: 'Food & Beverage / Hospitality',
    keywords: [
      'restaurant', 'restoran', 'cafe', 'kafe', 'food and beverage', 'f&b',
      'kuliner', 'catering', 'hotel', 'hospitality', 'perhotelan', 'resort',
      'bakery', 'kitchen', 'chef', 'barista',
    ],
  },
  {
    name: 'Banking & Financial Services',
    keywords: [
      'bank', 'banking', 'perbankan', 'financial services', 'lembaga keuangan',
      'fintech', 'lending', 'pembiayaan', 'multifinance', 'credit', 'kredit',
      'treasury', 'investment bank',
    ],
  },
  {
    name: 'Insurance',
    keywords: ['insurance', 'asuransi', 'underwriting', 'actuary', 'aktuaria', 'polis'],
  },
  {
    name: 'Technology / IT / Software',
    keywords: [
      'software', 'it company', 'teknologi informasi', 'saas', 'startup',
      'developer', 'programmer', 'engineering team', 'tech company', 'cloud',
      'cyber security', 'data science', 'artificial intelligence', 'IT department',
    ],
  },
  {
    name: 'E-commerce',
    keywords: [
      'e-commerce', 'ecommerce', 'online marketplace', 'marketplace',
      'online shop', 'toko online', 'digital marketplace',
    ],
  },
  {
    name: 'Healthcare & Pharmaceuticals',
    keywords: [
      'hospital', 'rumah sakit', 'healthcare', 'kesehatan', 'pharmaceutical',
      'farmasi', 'clinic', 'klinik', 'medical device', 'apotek', 'pharmacy',
      'nurse', 'perawat', 'dokter', 'physician',
    ],
  },
  {
    name: 'Property & Real Estate',
    keywords: [
      'property', 'properti', 'real estate', 'developer properti', 'apartment',
      'apartemen', 'perumahan', 'housing', 'realty',
    ],
  },
  {
    name: 'Construction & Engineering',
    keywords: [
      'construction', 'konstruksi', 'kontraktor', 'contractor', 'civil engineering',
      'infrastructure', 'infrastruktur', 'engineering, procurement',
    ],
  },
  {
    name: 'Manufacturing & Industrial',
    keywords: [
      'manufacturing', 'manufaktur', 'pabrik', 'factory', 'produksi', 'production plant',
      'industrial', 'industri', 'assembly line',
    ],
  },
  {
    name: 'Automotive',
    keywords: ['automotive', 'otomotif', 'dealership mobil', 'spare part', 'showroom mobil', 'vehicle'],
  },
  {
    name: 'Logistics & Supply Chain',
    keywords: [
      'logistics', 'logistik', 'supply chain', 'warehouse', 'gudang',
      'freight', 'shipping', 'ekspedisi', 'distribution center', 'transportasi',
      'trucking', 'fleet',
    ],
  },
  {
    name: 'Oil, Gas, Mining & Energy',
    keywords: [
      'oil and gas', 'minyak dan gas', 'migas', 'mining', 'pertambangan',
      'tambang', 'coal', 'batu bara', 'energy company', 'renewable energy', 'power plant',
    ],
  },
  {
    name: 'Telecommunications',
    keywords: ['telecommunication', 'telekomunikasi', 'telco', 'internet provider', 'network operator'],
  },
  {
    name: 'Media, Advertising & Creative',
    keywords: [
      'media company', 'advertising', 'periklanan', 'creative agency',
      'digital agency', 'broadcasting', 'penyiaran', 'publishing', 'penerbitan',
      'production house',
    ],
  },
  {
    name: 'Education & Training',
    keywords: [
      'education', 'pendidikan', 'school', 'sekolah', 'university', 'universitas',
      'training center', 'lembaga pelatihan', 'bimbingan belajar', 'e-learning',
    ],
  },
  {
    name: 'Agriculture & Plantation',
    keywords: ['agriculture', 'pertanian', 'plantation', 'perkebunan', 'agribusiness', 'agro', 'sawit', 'palm oil'],
  },
  {
    name: 'Professional Services (Consulting/Legal/Accounting)',
    keywords: [
      'consulting firm', 'konsultan', 'law firm', 'kantor hukum', 'accounting firm',
      'kantor akuntan', 'audit firm', 'advisory', 'notaris',
    ],
  },
  {
    name: 'Government / Non-Profit',
    keywords: [
      'kementerian', 'pemerintah', 'government', 'ngo', 'yayasan', 'foundation',
      'non-profit', 'nirlaba', 'lsm',
    ],
  },
];

/**
 * Deteksi industri dari kumpulan teks (job title + description + requirements, dll).
 * Return { industry, confidence, scores } — confidence: "high" | "medium" | "low".
 */
function detectIndustry(...textParts) {
  const text = textParts.filter(Boolean).join(' \n ').toLowerCase();

  if (!text.trim()) {
    return { industry: 'Not Identified', confidence: 'low', scores: [] };
  }

  const scores = CATEGORIES.map((cat) => {
    let score = 0;
    for (const kw of cat.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = text.match(new RegExp(escaped, 'g'));
      if (matches) score += matches.length;
    }
    return { name: cat.name, score };
  }).sort((a, b) => b.score - a.score);

  const top = scores[0];

  if (!top || top.score === 0) {
    return { industry: 'Not Identified', confidence: 'low', scores };
  }

  const second = scores[1];
  const confidence = top.score >= 3 && (!second || top.score >= second.score * 2)
    ? 'high'
    : top.score >= 1
      ? 'medium'
      : 'low';

  return { industry: top.name, confidence, scores };
}

module.exports = { detectIndustry, CATEGORIES };
