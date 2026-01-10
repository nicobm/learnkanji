// Constantes de configuración
const MAX_KANJI_PER_PART_DEFAULT = 45;
const TARGET_PARTS_JLPT_N1 = 9;
const NUM_QUIZ_OPTIONS = 6;

// Configuración de dificultad
const KOTOBA_KANJI_MAX_DIFFICULTY = {
    5: [6, 1, 10],
    4: [8, 2, 15],
    3: [10, 4, 20],
    2: [12, 6, 24],
    1: [14, 8, 28],
};

const CONFUSING_MEANINGS_BLACKLIST = new Set([
    'Turkey', 'U.S.A.', 'USA', 'America', 'United States', 'Great Britain',
    'England', 'UK', 'U.K.', 'France', 'Germany', 'Italy', 'Russia',
    'Spain', 'Portugal', 'Holland', 'Netherlands', 'Belgium', 'India',
    'metre', 'gram', 'litre', 'liter', 'watt', 'page'
]);

const JLPT_LEVEL_COLORS = {
    'jlpt5': 'btn-success', 'jlpt4': 'btn-info', 'jlpt3': 'btn-warning text-dark',
    'jlpt2': 'btn-danger', 'jlpt1': 'btn-secondary',
};

// --- Funciones de Utilidad (Helpers) ---

function kata2hira(str) {
    return str.replace(/[\u30a1-\u30f6]/g, function(match) {
        var chr = match.charCodeAt(0) - 0x60;
        return String.fromCharCode(chr);
    });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getOkuriganaEnding(word) {
    if (!word) return "";
    let ending = "";
    for (let i = word.length - 1; i >= 0; i--) {
        const charCode = word.charCodeAt(i);
        if (charCode >= 0x3041 && charCode <= 0x3096) {
            ending = word[i] + ending;
        } else {
            break;
        }
    }
    return ending;
}

function cleanReadings(readings) {
    if (!readings) return [];
    const unique = new Set();
    readings.forEach(r => {
        if (!r) return;
        let clean = r.replace(/^-|-$/g, '');
        if (clean) unique.add(clean);
    });
    return Array.from(unique).sort();
}

// --- Vue App ---

new Vue({
    el: '#app',
    data: {
        loadingData: true,
        jsonLoadError: null,
        
        // Base de datos en memoria
        allKanjiData: {}, 
        allWordsData: {}, 
        vocabByLevelCache: {}, 
        
        // Estado UI
        darkMode: false,
        selectedLevel: null,
        quizMode: 'kanji',
        availableParts: [],

        // Estado del Quiz
        quizQueue: [], 
        currentQuestion: null, 
        options: [],
        
        // Progreso
        currentItemOrderIndex: 0,
        totalItemsInLevel: 0,
        
        // Interacción
        isLoading: false,
        answeredCorrectly: false,
        incorrectlySelectedOptions: []
    },
    computed: {
        currentDisplayChar() {
            if (!this.currentQuestion) return '';
            return this.quizMode === 'kanji' ? this.currentQuestion.kanji : this.currentQuestion.word;
        },
        currentMeaning() {
            if (!this.currentQuestion) return '';
            return this.currentQuestion.meaning;
        },
        currentCorrectContextualReading() {
            if (!this.currentQuestion) return '';
            return this.currentQuestion.correct_contextual_reading || '';
        },
        progressPercentage() {
            if (this.totalItemsInLevel === 0) return 0;
            return ((this.currentItemOrderIndex) / this.totalItemsInLevel) * 100;
        }
    },
    watch: {
        darkMode(val) {
            document.documentElement.setAttribute('data-bs-theme', val ? 'dark' : 'light');
            localStorage.setItem('theme', val ? 'dark' : 'light');
        }
    },
    created() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            this.darkMode = savedTheme === 'dark';
        } else {
            this.darkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        
        this.loadData();
    },
    methods: {
        async loadData() {
            this.loadingData = true;
            this.jsonLoadError = null;
            try {
                // Fetch al archivo JSON estático
                const response = await fetch('kanjiapi_small.json');
                if (!response.ok) throw new Error("No se pudo cargar 'kanjiapi_small.json' (Estado: " + response.status + ")");
                
                const data = await response.json();
                this.allKanjiData = data.kanjis || {};
                this.allWordsData = data.words || {};
                
                this.preloadVocabulary();
                this.generatePartsList();
                
                this.loadingData = false;
            } catch (e) {
                console.error(e);
                this.jsonLoadError = "Error cargando datos: " + e.message;
                this.loadingData = false;
            }
        },

        retryLoad() {
            this.loadData();
        },

        preloadVocabulary() {
            const levels = {1: {}, 2: {}, 3: {}, 4: {}, 5: {}};
            const uniqueSet = new Set();

            for (const key in this.allWordsData) {
                const entries = this.allWordsData[key];
                if (!Array.isArray(entries)) continue;

                entries.forEach(entry => {
                    const variants = entry.variants || [];
                    const meanings = entry.meanings || [];
                    if (variants.length === 0 || meanings.length === 0) return;

                    const word = variants[0].written;
                    const reading = variants[0].pronounced;
                    
                    let minLevel = null; 
                    let isValid = true;
                    
                    for (const char of word) {
                        if (char >= '\u4e00' && char <= '\u9faf') {
                            const kData = this.allKanjiData[char];
                            if (!kData || !kData.jlpt) {
                                isValid = false; break;
                            }
                            if (minLevel === null || kData.jlpt < minLevel) {
                                minLevel = kData.jlpt;
                            }
                        }
                    }

                    if (!isValid || minLevel === null) return;
                    
                    const firstGloss = meanings[0].glosses ? meanings[0].glosses[0] : '';
                    const uniqueKey = `${word}|${reading}|${firstGloss}`;
                    
                    if (uniqueSet.has(uniqueKey)) return;
                    uniqueSet.add(uniqueKey);

                    const ending = getOkuriganaEnding(word);
                    if (!levels[minLevel][ending]) levels[minLevel][ending] = [];
                    
                    levels[minLevel][ending].push({
                        word: word,
                        reading: reading,
                        meanings: meanings
                    });
                });
            }
            this.vocabByLevelCache = levels;
        },

        generatePartsList() {
            const parts = [];
            ['jlpt5', 'jlpt4', 'jlpt3', 'jlpt2', 'jlpt1'].forEach(lvlStr => {
                const lvlNum = parseInt(lvlStr.replace('jlpt', ''));
                
                const kanjisInLevel = Object.keys(this.allKanjiData).filter(k => 
                    this.allKanjiData[k].jlpt === lvlNum
                ).sort();

                if (kanjisInLevel.length === 0) return;

                let kpp = MAX_KANJI_PER_PART_DEFAULT;
                if (lvlStr === 'jlpt1') {
                    kpp = Math.max(1, Math.ceil(kanjisInLevel.length / TARGET_PARTS_JLPT_N1));
                }
                
                const numParts = Math.ceil(kanjisInLevel.length / kpp);
                
                let vocabCount = 0;
                const vocabGroups = this.vocabByLevelCache[lvlNum] || {};
                const flatVocab = [];
                Object.values(vocabGroups).forEach(group => {
                    if (group.length >= NUM_QUIZ_OPTIONS) {
                        flatVocab.push(...group);
                    }
                });
                vocabCount = flatVocab.length;
                const wordsPerPart = Math.ceil(vocabCount / numParts);

                for (let i = 1; i <= numParts; i++) {
                    const startK = (i - 1) * kpp;
                    const pLen = kanjisInLevel.slice(startK, startK + kpp).length;
                    
                    const startW = (i - 1) * wordsPerPart;
                    const wLen = flatVocab.slice(startW, startW + wordsPerPart).length;

                    parts.push({
                        id: `${lvlStr}_${i}`,
                        name: `JLPT N${lvlNum}` + (numParts > 1 ? ` (${i}/${numParts})` : ''),
                        originalLevel: lvlStr,
                        count: pLen,
                        kotoba_count: wLen,
                        colorClass: JLPT_LEVEL_COLORS[lvlStr] || 'btn-secondary',
                        kanjiList: kanjisInLevel, 
                        kpp: kpp,
                        partNum: i,
                        fullVocab: flatVocab 
                    });
                }
            });
            this.availableParts = parts;
        },

        startLevel(part) {
            this.selectedLevel = part;
            this.answeredCorrectly = false;
            this.incorrectlySelectedOptions = [];
            this.isLoading = true;

            if (this.quizMode === 'kanji') {
                this.generateKanjiQuiz(part);
            } else {
                this.generateVocabQuiz(part);
            }
        },

        generateKanjiQuiz(part) {
            const start = (part.partNum - 1) * part.kpp;
            const end = start + part.kpp;
            const targetKanjis = part.kanjiList.slice(start, end);
            
            shuffleArray(targetKanjis);

            this.quizQueue = targetKanjis.map(char => {
                const details = this.allKanjiData[char];
                if (!details) return null;

                const kuns = details.kun_readings || [];
                const ons = details.on_readings || [];
                
                let correctHira = "";
                let correctType = ""; 
                let displayComp = ""; 
                
                const cleanKuns = cleanReadings(kuns);
                const cleanOns = cleanReadings(ons);

                if (cleanKuns.length > 0) {
                    const raw = cleanKuns[0];
                    correctHira = raw.split('.')[0]; 
                    correctType = 'kun';
                    displayComp = raw.replace('.', '');
                } else if (cleanOns.length > 0) {
                    const raw = cleanOns[0];
                    correctHira = kata2hira(raw);
                    correctType = 'on';
                    displayComp = raw;
                } else {
                    return null; 
                }

                const meanings = (details.meanings || []).filter(m => !CONFUSING_MEANINGS_BLACKLIST.has(m));
                const meaningStr = meanings.slice(0, 3).join("; ") || "S/D";

                const options = this.generateKanjiOptions(correctHira, correctType, displayComp, cleanKuns, cleanOns, part.kanjiList, char);

                return {
                    kanji: char,
                    meaning: meaningStr,
                    correct_value: correctHira,
                    options: options,
                    correct_contextual_reading: displayComp
                };
            }).filter(q => q !== null);

            this.finalizeQuizSetup();
        },

        generateKanjiOptions(correctVal, type, displayComp, kuns, ons, allKanjisInLevel, currentChar) {
            const opts = [];
            
            opts.push({
                value: correctVal,
                display_kun: type === 'kun' ? displayComp : (kuns[0] || '-'),
                display_on_kata: type === 'on' ? displayComp : (ons[0] || '-')
            });

            const pool = shuffleArray(allKanjisInLevel.filter(k => k !== currentChar));
            
            for (const otherChar of pool) {
                if (opts.length >= NUM_QUIZ_OPTIONS) break;
                
                const dDetails = this.allKanjiData[otherChar];
                if (!dDetails) continue;

                const dKuns = cleanReadings(dDetails.kun_readings);
                const dOns = cleanReadings(dDetails.on_readings);
                
                let distractor = null;
                if (dKuns.length > 0) {
                    distractor = {
                        val: dKuns[0].split('.')[0],
                        kun: dKuns[0].replace('.', ''),
                        on: dOns[0] || '-'
                    };
                } else if (dOns.length > 0) {
                     distractor = {
                        val: kata2hira(dOns[0]),
                        kun: '-',
                        on: dOns[0]
                    };
                }

                if (distractor && !opts.some(o => o.value === distractor.val)) {
                    opts.push({
                        value: distractor.val,
                        display_kun: distractor.kun,
                        display_on_kata: distractor.on
                    });
                }
            }

            return shuffleArray(opts);
        },

        generateVocabQuiz(part) {
            const vocabCount = part.fullVocab.length; 
            const numParts = Math.ceil(part.kanjiList.length / part.kpp); 
            const wordsPerPart = Math.ceil(vocabCount / numParts);
            
            const start = (part.partNum - 1) * wordsPerPart;
            const end = start + wordsPerPart;
            const targetWords = part.fullVocab.slice(start, end);

            const levelNum = parseInt(part.originalLevel.replace('jlpt', ''));
            const vocabGroups = this.vocabByLevelCache[levelNum];

            shuffleArray(targetWords);

            this.quizQueue = targetWords.map(wordObj => {
                const correctReading = wordObj.reading;
                const ending = getOkuriganaEnding(wordObj.word);
                
                const group = vocabGroups[ending] || [];
                const pool = group.filter(w => w.reading !== correctReading && w.reading.length === correctReading.length);
                
                if (pool.length < NUM_QUIZ_OPTIONS - 1) return null; 

                shuffleArray(pool);
                
                const opts = [{ value: correctReading }];
                pool.slice(0, NUM_QUIZ_OPTIONS - 1).forEach(d => opts.push({ value: d.reading }));
                
                const glosses = [];
                wordObj.meanings.forEach(m => {
                    if (m.glosses) glosses.push(...m.glosses);
                });
                
                return {
                    word: wordObj.word,
                    meaning: glosses.slice(0, 3).join("; "),
                    correct_value: correctReading,
                    options: shuffleArray(opts)
                };
            }).filter(q => q !== null);

            this.finalizeQuizSetup();
        },

        finalizeQuizSetup() {
            this.totalItemsInLevel = this.quizQueue.length;
            this.currentItemOrderIndex = 0;
            this.isLoading = false;

            if (this.quizQueue.length > 0) {
                this.loadQuestion(0);
            } else {
                alert("No hay suficientes elementos para generar un quiz de este nivel.");
                this.resetToMenu();
            }
        },

        loadQuestion(index) {
            this.answeredCorrectly = false;
            this.incorrectlySelectedOptions = [];
            this.currentQuestion = this.quizQueue[index];
            this.options = this.currentQuestion.options;
        },

        checkAnswer(option) {
            if (this.answeredCorrectly) return;

            if (option.value === this.currentQuestion.correct_value) {
                this.answeredCorrectly = true;
                setTimeout(() => {
                    if (this.currentItemOrderIndex < this.totalItemsInLevel - 1) {
                        this.currentItemOrderIndex++;
                        this.loadQuestion(this.currentItemOrderIndex);
                    } else {
                        alert("¡Nivel Completado!");
                        this.resetToMenu();
                    }
                }, 1500); 
            } else {
                this.incorrectlySelectedOptions.push(option.value);
            }
        },

        getButtonClass(option) {
            if (this.answeredCorrectly && option.value === this.currentQuestion.correct_value) {
                return 'btn-success animate-pulse';
            }
            if (this.incorrectlySelectedOptions.includes(option.value)) {
                return 'btn-danger shake';
            }
            return this.darkMode ? 'btn-outline-light' : 'btn-outline-primary';
        },

        resetToMenu() {
            this.selectedLevel = null;
            this.currentQuestion = null;
        }
    }
});
