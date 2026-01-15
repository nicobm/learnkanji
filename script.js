/*
    KANJI MASTER JS - LOGIC CORE
    
    Resumen de Funcionalidad:
    Esta aplicación gestiona la lógica de aprendizaje de Kanji y Vocabulario.
    
    Conceptos Clave:
    1. Smart Distractors (Engaño Inteligente): 
       La aplicación NO elige respuestas al azar. Busca activamente confundir al usuario
       seleccionando opciones que se parecen a la respuesta correcta (misma longitud, 
       primeros caracteres similares, o lecturas alternativas del mismo Kanji).
       Esto fuerza al usuario a reconocer realmente el caracter, no solo a adivinar por descarte.
    
    2. Progresión JLPT:
       Los datos se cargan desde un JSON externo y se agrupan dinámicamente en "Partes" 
       manejables (aprox 45 items) basadas en niveles JLPT (N5 a N1).
    
    3. Game Loop:
       - Estado 'Pregunta': Muestra Kanji/Palabra gigante.
       - Interacción: El usuario toca una opción.
         - Incorrecto: El botón vibra (animación Tailwind), se marca rojo, vida baja.
         - Correcto: Feedback inmediato visual, transición de pantalla (animación suave hacia arriba), 
           se muestra lectura y significado.
    
    4. Manejo de Estado:
       Vue.js controla reactivamente toda la UI. No hay manipulación directa del DOM fuera de Vue.
       El cálculo de estadísticas (Accuracy/Hardest/Fastest) se realiza al final de la sesión.
*/

// Configuration Constants
const MAX_KANJI_PER_PART_DEFAULT = 45;
const TARGET_PARTS_JLPT_N1 = 9;
const NUM_QUIZ_OPTIONS = 6; 

// Helpers
function kata2hira(str) {
    return str.replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60));
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
        if (word.charCodeAt(i) >= 0x3041 && word.charCodeAt(i) <= 0x3096) ending = word[i] + ending;
        else break;
    }
    return ending;
}

function cleanReadings(readings) {
    if (!readings) return [];
    return [...new Set(readings.map(r => r ? r.replace(/^-|-$/g, '') : '').filter(Boolean))];
}

function getReadingLength(str) {
    return str.replace('.', '').length;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

new Vue({
    el: '#app',
    data: {
        loadingData: true,
        loadingMessage: "Initializing...",
        
        allKanjiData: {}, 
        vocabByLevelCache: {}, 
        
        selectedLevel: null,
        quizMode: 'kanji',
        availablePartsRaw: [],
        
        // Quiz State
        quizQueue: [], 
        currentQuestion: null, 
        options: [],
        currentItemOrderIndex: 0,
        totalItemsInLevel: 1,
        
        // Interaction State
        showImmediateCorrectFeedback: false, 
        incorrectlySelectedOptions: [],
        shakingBtnValue: null,
        
        // Stats Logic
        correctCount: 0,
        wrongCount: 0,
        
        // Timing & Session Results
        showResults: false,
        questionStartTime: 0,
        sessionStats: [], 
        finalStats: { accuracy: 0, totalTime: 0, hardest: [], fastest: [] }
    },
    computed: {
        orderedGroupedParts() {
            const groups = {};
            this.availablePartsRaw.forEach(part => {
                const lvl = part.originalLevel.replace('jlpt', '');
                if (!groups[lvl]) {
                    groups[lvl] = { levelKey: lvl, displayName: lvl, parts: [] };
                }
                groups[lvl].parts.push(part);
            });
            return Object.values(groups).sort((a, b) => b.levelKey - a.levelKey);
        },
        currentMeaning() {
            return this.currentQuestion ? this.currentQuestion.meaning : '';
        },
        progressPercentage() {
            if (this.totalItemsInLevel === 0) return 0;
            return ((this.currentItemOrderIndex) / this.totalItemsInLevel) * 100;
        },
        currentAccuracy() {
            if (this.totalItemsInLevel === 0) return 100;
            const wrongOptionsPerQuestion = NUM_QUIZ_OPTIONS - 1;
            const totalLifePoints = this.totalItemsInLevel * wrongOptionsPerQuestion;
            if (totalLifePoints === 0) return 100;
            const currentLife = totalLifePoints - this.wrongCount;
            const percentage = (currentLife / totalLifePoints) * 100;
            return Math.max(0, Math.min(100, Math.round(percentage)));
        },
        accuracyColorClass() {
            const acc = this.currentAccuracy;
            if (acc >= 70) return 'bg-success'; 
            if (acc >= 40) return 'bg-yellow-400'; 
            return 'bg-danger';                 
        },
        accuracyTextColor() {
            const acc = this.currentAccuracy;
            if (acc >= 70) return 'text-success'; 
            if (acc >= 40) return 'text-yellow-500'; 
            return 'text-danger';  
        },
        dynamicFontSize() {
            // Ajuste dinámico de fuente para asegurar que encaje en pantalla sin scroll
            if (!this.currentQuestion) return '5rem';
            
            // Si ya se respondió correctamente, reducimos drásticamente el tamaño (animación)
            if (this.showImmediateCorrectFeedback) {
                return '4rem'; 
            }

            const text = this.quizMode === 'kanji' ? this.currentQuestion.kanji : this.currentQuestion.word;
            const len = text.length;
            
            if (this.quizMode === 'kanji') return 'clamp(5rem, 15vw, 8rem)';
            
            if (len <= 2) return 'clamp(4rem, 12vw, 6rem)';
            if (len <= 4) return 'clamp(3rem, 10vw, 4.5rem)';
            if (len <= 6) return 'clamp(2rem, 8vw, 3.5rem)';
            return 'clamp(1.5rem, 6vw, 2.5rem)';
        }
    },
    created() {
        this.loadData();
    },
    methods: {
        async loadData() {
            this.loadingData = true;
            try {
                this.loadingMessage = "Loading dictionary...";
                const response = await fetch('kanjiapi_small.json');
                if (!response.ok) throw new Error("HTTP Error: " + response.status);
                
                const data = await response.json();
                
                const rawKanjis = data.k || {};
                const processedKanjis = {};
                
                Object.keys(rawKanjis).forEach(char => {
                    const info = rawKanjis[char];
                    processedKanjis[char] = {
                        jlpt: info[0],
                        meanings: info[3] ? info[3].split(';').map(s=>s.trim()) : [],
                        kun_readings: info[4] || [],
                        on_readings: info[5] || []
                    };
                });
                this.allKanjiData = processedKanjis;
                
                await this.preloadVocabulary(data.v || {});
                await this.generatePartsList();

                this.loadingData = false;
            } catch (e) {
                console.error(e);
                this.loadingData = false;
            }
        },

        async preloadVocabulary(rawVocabData) {
            const levels = {1: {}, 2: {}, 3: {}, 4: {}, 5: {}};
            const availableLevels = Object.keys(rawVocabData);
            
            for (const lvlKey of availableLevels) {
                const lvlNum = parseInt(lvlKey);
                if (!levels[lvlNum]) levels[lvlNum] = {};
                
                const groups = rawVocabData[lvlKey];
                for (const groupKey in groups) {
                    const wordsArray = groups[groupKey];
                    for (const wEntry of wordsArray) {
                        const word = wEntry[0];
                        const reading = wEntry[1];
                        const meaningStr = wEntry[2];

                        if (reading.includes(' ') || reading.includes('を')) continue;
                        
                        const ending = getOkuriganaEnding(word);
                        if (!levels[lvlNum][ending]) levels[lvlNum][ending] = [];
                        
                        levels[lvlNum][ending].push({
                            word: word,
                            reading: reading,
                            len: reading.length, 
                            meanings: [{ glosses: [meaningStr] }]
                        });
                    }
                }
                if (lvlNum % 2 === 0) await sleep(5);
            }
            this.vocabByLevelCache = levels;
        },

        async generatePartsList() {
            const parts = [];
            const levels = ['jlpt5', 'jlpt4', 'jlpt3', 'jlpt2', 'jlpt1'];

            for (const lvlStr of levels) {
                const lvlNum = parseInt(lvlStr.replace('jlpt', ''));
                
                const kanjisInLevel = Object.keys(this.allKanjiData)
                    .filter(k => this.allKanjiData[k].jlpt === lvlNum)
                    .sort();

                if (kanjisInLevel.length === 0) continue;

                let kpp = MAX_KANJI_PER_PART_DEFAULT;
                if (lvlStr === 'jlpt1') kpp = Math.max(1, Math.ceil(kanjisInLevel.length / TARGET_PARTS_JLPT_N1));
                
                const numParts = Math.ceil(kanjisInLevel.length / kpp);
                const vocabGroups = this.vocabByLevelCache[lvlNum] || {};
                const allWordsInLevel = Object.values(vocabGroups).flat();
                
                const validVocab = allWordsInLevel.filter(w => {
                    const ending = getOkuriganaEnding(w.word);
                    const group = vocabGroups[ending];
                    return group && group.length >= NUM_QUIZ_OPTIONS; 
                });

                const wordsPerPart = Math.ceil(validVocab.length / numParts);

                for (let i = 1; i <= numParts; i++) {
                    const startW = (i - 1) * wordsPerPart;
                    parts.push({
                        id: `${lvlStr}_${i}`,
                        name: `JLPT N${lvlNum}`,
                        originalLevel: lvlStr,
                        count: kanjisInLevel.slice((i-1)*kpp, i*kpp).length,
                        kotoba_count: validVocab.slice(startW, startW + wordsPerPart).length,
                        kanjiList: kanjisInLevel.slice((i-1)*kpp, i*kpp),
                        fullVocabPart: validVocab.slice(startW, startW + wordsPerPart),
                        partNum: i,
                        totalParts: numParts
                    });
                }
            }
            this.availablePartsRaw = parts;
        },

        startLevel(part, mode) {
            this.selectedLevel = part;
            this.quizMode = mode;
            this.showImmediateCorrectFeedback = false;
            this.showResults = false;
            this.incorrectlySelectedOptions = [];
            this.sessionStats = []; 
            this.correctCount = 0; 
            this.wrongCount = 0;
            
            if (mode === 'kanji') this.generateKanjiQuiz(part);
            else this.generateVocabQuiz(part);
        },

        generateKanjiQuiz(part) {
            const queue = part.kanjiList.map(char => {
                const d = this.allKanjiData[char];
                if (!d) return null;
                const kuns = cleanReadings(d.kun_readings);
                const ons = cleanReadings(d.on_readings);
                let corrVal = "", corrType = "", dispComp = "", targetKunLen = 0, targetOnLen = 0;
                
                if (kuns.length > 0) {
                    corrVal = kuns[0].split('.')[0]; 
                    corrType = 'kun'; 
                    dispComp = kuns[0].replace('.', '');
                } else if (ons.length > 0) {
                    corrVal = kata2hira(ons[0]); 
                    corrType = 'on'; 
                    dispComp = ons[0];
                } else return null;

                targetKunLen = kuns.length > 0 ? getReadingLength(kuns[0]) : 0;
                targetOnLen = ons.length > 0 ? getReadingLength(ons[0]) : 0;

                const opts = this.getSmartDistractors(char, corrVal, corrType, dispComp, kuns, ons, targetKunLen, targetOnLen, part.kanjiList);
                
                return {
                    kanji: char,
                    meaning: (d.meanings || []).slice(0, 3).join("; "),
                    correct_value: corrVal,
                    correct_contextual_reading: dispComp,
                    options: opts
                };
            }).filter(q => q);
            
            this.startQuiz(queue);
        },

        getSmartDistractors(correctChar, correctVal, type, displayComp, kuns, ons, targetKunLen, targetOnLen, levelList) {
            const correctOpt = { 
                value: correctVal, 
                display_kun: type === 'kun' ? displayComp : (kuns[0] || '-'), 
                display_on_kata: type === 'on' ? displayComp : (ons[0] || '-') 
            };
            
            const distractors = [];
            const needed = NUM_QUIZ_OPTIONS - 1;
            const candidates = levelList.filter(k => k !== correctChar);
            
            const perfectMatches = []; 
            const strongMatches = [];  
            const looseMatches = [];   
            
            const startIndex = Math.floor(Math.random() * candidates.length);
            
            for (let i = 0; i < candidates.length; i++) {
                const idx = (startIndex + i) % candidates.length;
                const char = candidates[idx];
                const d = this.allKanjiData[char];
                if(!d) continue;

                const dk = cleanReadings(d.kun_readings);
                const do_ = cleanReadings(d.on_readings);
                
                let dVal = "", dKunDisplay = "-", dOnDisplay = "-";
                let dKunLen = 0, dOnLen = 0;

                if (dk.length > 0) {
                    dVal = dk[0].split('.')[0];
                    dKunDisplay = dk[0].replace('.', '');
                    dKunLen = getReadingLength(dk[0]);
                } else if (do_.length > 0) {
                    dVal = kata2hira(do_[0]);
                }

                if (do_.length > 0) {
                    dOnDisplay = do_[0];
                    dOnLen = getReadingLength(do_[0]);
                    if (!dVal) dVal = kata2hira(do_[0]); 
                }

                if (!dVal || dVal === correctVal) continue;
                if (distractors.some(opt => opt.value === dVal)) continue;

                const distObj = { value: dVal, display_kun: dKunDisplay, display_on_kata: dOnDisplay };
                
                const kunDiff = Math.abs(dKunLen - targetKunLen);
                const onDiff = Math.abs(dOnLen - targetOnLen);

                if (kunDiff === 0 && onDiff === 0) perfectMatches.push(distObj);
                else if ((type === 'kun' && kunDiff === 0) || (type === 'on' && onDiff === 0)) strongMatches.push(distObj);
                else if (kunDiff <= 1 || onDiff <= 1) looseMatches.push(distObj);

                if (perfectMatches.length >= needed) break;
            }

            distractors.push(...perfectMatches);
            if (distractors.length < needed) {
                const neededStrong = needed - distractors.length;
                distractors.push(...strongMatches.slice(0, neededStrong));
            }
            if (distractors.length < needed) {
                const neededLoose = needed - distractors.length;
                distractors.push(...looseMatches.slice(0, neededLoose));
            }

            if (distractors.length < needed) {
                for (let i = 0; i < candidates.length; i++) {
                    if (distractors.length >= needed) break;
                    const char = candidates[i];
                    const d = this.allKanjiData[char];
                    if(!d) continue;
                    const dk = cleanReadings(d.kun_readings);
                    const do_ = cleanReadings(d.on_readings);
                    let val = dk.length > 0 ? dk[0].split('.')[0] : (do_.length > 0 ? kata2hira(do_[0]) : null);
                    if (val && val !== correctVal && !distractors.some(x => x.value === val)) {
                         distractors.push({ 
                             value: val, 
                             display_kun: dk.length ? dk[0].replace('.','') : '-', 
                             display_on_kata: do_.length ? do_[0] : '-' 
                         });
                    }
                }
            }
            return shuffleArray([correctOpt, ...distractors.slice(0, needed)]);
        },

        generateVocabQuiz(part) {
            const queue = part.fullVocabPart.map(w => {
                const ending = getOkuriganaEnding(w.word);
                const pool = this.vocabByLevelCache[parseInt(part.originalLevel.replace('jlpt',''))][ending] || [];
                const targetLen = w.reading.length;
                let validCandidates = pool.filter(x => x.reading !== w.reading);
                
                let smartDistractors = validCandidates.filter(x => x.len === targetLen);
                if (smartDistractors.length < NUM_QUIZ_OPTIONS - 1) {
                    const loose = validCandidates.filter(x => Math.abs(x.len - targetLen) === 1);
                    smartDistractors = smartDistractors.concat(loose);
                }
                if (smartDistractors.length < NUM_QUIZ_OPTIONS - 1) smartDistractors = validCandidates; 
                if (smartDistractors.length < NUM_QUIZ_OPTIONS - 1) return null;

                const selectedDists = shuffleArray(smartDistractors).slice(0, NUM_QUIZ_OPTIONS-1);
                const opts = [{value: w.reading}, ...selectedDists.map(d => ({value: d.reading}))];
                
                return {
                    word: w.word,
                    correct_value: w.reading,
                    correct_contextual_reading: w.reading,
                    meaning: (w.meanings[0].glosses || []).join(", "),
                    options: shuffleArray(opts)
                };
            }).filter(q => q);
            
            this.startQuiz(queue);
        },

        startQuiz(queue) {
            shuffleArray(queue);
            this.quizQueue = queue;
            this.totalItemsInLevel = queue.length;
            this.currentItemOrderIndex = 0;
            if (queue.length > 0) this.loadQuestion(0);
            else this.resetToMenu();
        },

        loadQuestion(idx) {
            this.showImmediateCorrectFeedback = false;
            this.incorrectlySelectedOptions = [];
            this.currentQuestion = this.quizQueue[idx];
            this.options = this.currentQuestion.options;
            this.questionStartTime = Date.now();
        },
        
        getOptionClass(option) {
            const isSelectedWrong = this.incorrectlySelectedOptions.includes(option.value);
            const isCorrect = option.value === this.currentQuestion.correct_value;
            const isShaking = this.shakingBtnValue === option.value;
            
            // Usamos animate-shake definido en tailwind config
            let classes = [];
            
            if (isShaking) classes.push('animate-shake');
            
            if (this.showImmediateCorrectFeedback) {
                if (isCorrect) {
                    classes.push('bg-success text-white border-success');
                } else if (isSelectedWrong) {
                    classes.push('bg-danger text-white border-danger opacity-50');
                } else {
                    classes.push('bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600');
                }
            } else {
                if (isSelectedWrong) {
                    classes.push('bg-danger text-white border-danger');
                } else {
                    // Estado Normal: Borde gris (gray-300 / dark:gray-600)
                    classes.push('bg-white dark:bg-darkcard text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700');
                }
            }
            
            return classes.join(' ');
        },

        checkAnswer(option) {
            if (this.showImmediateCorrectFeedback) return;

            if (option.value === this.currentQuestion.correct_value) {
                this.showImmediateCorrectFeedback = true;
                this.correctCount++;
                
                const timeTaken = Date.now() - this.questionStartTime;
                const itemKey = this.quizMode === 'kanji' ? this.currentQuestion.kanji : this.currentQuestion.word;
                const wrongForThis = this.incorrectlySelectedOptions.length;
                
                this.sessionStats.push({
                    key: itemKey,
                    time: timeTaken,
                    wrong: wrongForThis,
                    meaning: this.currentQuestion.meaning
                });

            } else {
                if (!this.incorrectlySelectedOptions.includes(option.value)) {
                    this.incorrectlySelectedOptions.push(option.value);
                    this.wrongCount++;
                }
                this.shakingBtnValue = option.value;
                setTimeout(() => { this.shakingBtnValue = null; }, 500);
            }
        },

        nextQuestion() {
            if (this.currentItemOrderIndex < this.totalItemsInLevel - 1) {
                this.currentItemOrderIndex++;
                this.loadQuestion(this.currentItemOrderIndex);
            } else {
                this.finishSession();
            }
        },
        
        finishSession() {
            const totalTime = this.sessionStats.reduce((acc, curr) => acc + curr.time, 0);
            const totalSec = Math.floor(totalTime / 1000);
            
            const hardest = [...this.sessionStats].sort((a, b) => {
                if (b.wrong !== a.wrong) return b.wrong - a.wrong;
                return b.time - a.time;
            }).slice(0, 10); 

            const fastest = [...this.sessionStats]
                .filter(x => x.wrong === 0)
                .sort((a, b) => a.time - b.time)
                .slice(0, 5); 

            this.finalStats = {
                accuracy: this.currentAccuracy,
                totalTime: totalSec,
                hardest: hardest,
                fastest: fastest
            };

            this.showResults = true;
        },

        resetToMenu() {
            this.selectedLevel = null;
            this.currentQuestion = null;
            this.showResults = false;
        }
    }
});
