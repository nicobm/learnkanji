// Constantes de configuración
const MAX_KANJI_PER_PART_DEFAULT = 45;
const TARGET_PARTS_JLPT_N1 = 9;
const NUM_QUIZ_OPTIONS = 6;

// Configuración de dificultad (Solo para referencia visual de niveles)
const JLPT_LEVEL_COLORS = {
    'jlpt5': 'btn-success', 'jlpt4': 'btn-info', 'jlpt3': 'btn-warning text-dark',
    'jlpt2': 'btn-danger', 'jlpt1': 'btn-secondary',
};

// --- Helpers ---
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

// Función de pausa
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

new Vue({
    el: '#app',
    data: {
        loadingData: true,
        loadingMessage: "Iniciando...",
        jsonLoadError: null,
        
        allKanjiData: {}, 
        // allWordsData ya no es estrictamente necesario globalmente con la nueva lógica, 
        // pero lo mantenemos por si acaso o para depuración.
        allWordsData: {}, 
        vocabByLevelCache: {}, 
        
        selectedLevel: null,
        quizMode: 'kanji',
        availablePartsRaw: [],
        
        quizQueue: [], 
        currentQuestion: null, 
        options: [],
        
        currentItemOrderIndex: 0,
        totalItemsInLevel: 0,
        
        isLoading: false,
        showImmediateCorrectFeedback: false, 
        incorrectlySelectedOptions: [],
        
        completedSessionItems: new Set(),
        correctCount: 0,
        wrongCount: 0
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
        kanjiListForLevel() {
            if (!this.selectedLevel) return [];
            return this.selectedLevel.kanjiList;
        },
        kotobaListForLevel() {
            if (!this.selectedLevel) return [];
            return this.selectedLevel.fullVocabPart;
        },
        currentCorrectContextualReading() {
            return this.currentQuestion ? this.currentQuestion.correct_contextual_reading : '';
        },
        currentMeaning() {
            return this.currentQuestion ? this.currentQuestion.meaning : '';
        },
        currentJapaneseMeaningKanjiForm() {
            if (!this.currentQuestion) return '';
            if (this.quizMode === 'kotoba') return '';
            return this.currentQuestion.kanji;
        },
        progressPercentage() {
            if (this.totalItemsInLevel === 0) return 0;
            return ((this.currentItemOrderIndex) / this.totalItemsInLevel) * 100;
        },
        levelTrulyCompleted() {
            return this.currentItemOrderIndex >= this.totalItemsInLevel - 1 && this.showImmediateCorrectFeedback;
        },
        winLossRatio() {
            const total = this.correctCount + this.wrongCount;
            return total === 0 ? 0 : Math.round((this.correctCount / total) * 100);
        },
        winLossColor() {
            if (this.winLossRatio >= 80) return 'text-success';
            if (this.winLossRatio >= 50) return 'text-warning';
            return 'text-danger';
        }
    },
    created() {
        this.loadData();
    },
    methods: {
        async loadData() {
            this.loadingData = true;
            this.jsonLoadError = null;

            try {
                this.loadingMessage = "Descargando diccionario optimizado...";
                const response = await fetch('kanjiapi_small.json');
                if (!response.ok) throw new Error("Error HTTP: " + response.status);
                
                this.loadingMessage = "Desempaquetando datos...";
                await sleep(50);
                const data = await response.json();
                
                // --- 1. PROCESAR KANJIS (key "k") ---
                // Formato Small: "一": [5, 1, 1, "meaning", [kun], [on]]
                // Lo convertimos al objeto que tu app espera.
                const rawKanjis = data.k || {};
                const processedKanjis = {};
                
                Object.keys(rawKanjis).forEach(char => {
                    const info = rawKanjis[char];
                    processedKanjis[char] = {
                        jlpt: info[0],
                        grade: info[1],
                        strokes: info[2],
                        // Convertimos string "significado1; significado2" a array para mantener compatibilidad
                        meanings: info[3] ? info[3].split(';').map(s=>s.trim()) : [],
                        kun_readings: info[4] || [],
                        on_readings: info[5] || []
                    };
                });
                
                this.allKanjiData = processedKanjis;
                
                // Pasamos la data "v" cruda a preloadVocabulary para procesarla allí
                await this.preloadVocabulary(data.v || {});
                await this.generatePartsList();

                this.loadingData = false;
            } catch (e) {
                console.error(e);
                this.jsonLoadError = e.message;
                this.loadingData = false;
            }
        },

        async preloadVocabulary(rawVocabData) {
            // rawVocabData es data.v -> { "5": { "grupoclave": [ [palabra, lectura, significado], ... ] }, "4": ... }
            
            const levels = {1: {}, 2: {}, 3: {}, 4: {}, 5: {}};
            
            // Iteramos por los niveles que ya vienen en el JSON (gran ventaja del optimizador)
            const availableLevels = Object.keys(rawVocabData); // ["1", "2", "3", "4", "5"]
            
            let totalWordsProcessed = 0;
            
            for (const lvlKey of availableLevels) {
                const lvlNum = parseInt(lvlKey);
                if (!levels[lvlNum]) levels[lvlNum] = {}; // seguridad
                
                const groups = rawVocabData[lvlKey]; // Objeto con grupos
                
                // Recorremos los grupos dentro del nivel
                for (const groupKey in groups) {
                    const wordsArray = groups[groupKey]; // Array de arrays
                    
                    for (const wEntry of wordsArray) {
                        // wEntry es [ "Palabra", "Lectura", "Significado" ]
                        const word = wEntry[0];
                        const reading = wEntry[1];
                        const meaningStr = wEntry[2];

                        // Filtros originales de tu script
                        if (reading.includes(' ') || reading.includes('を')) continue;

                        // Tu app espera una estructura de meanings compleja: w.meanings[0].glosses
                        // Lo simulamos para no romper el resto del código
                        const meaningsObject = [{ glosses: [meaningStr] }];

                        // Usamos tu lógica de Okurigana para agrupar distractores
                        const ending = getOkuriganaEnding(word);
                        if (!levels[lvlNum][ending]) levels[lvlNum][ending] = [];
                        
                        levels[lvlNum][ending].push({
                            word: word,
                            reading: reading,
                            meanings: meaningsObject
                        });
                        
                        totalWordsProcessed++;
                    }
                }
                
                // Actualización visual UI
                this.loadingMessage = `Procesando vocabulario N${lvlKey}...`;
                await sleep(10);
            }

            console.log(`Vocabulario total cargado: ${totalWordsProcessed}`);
            this.vocabByLevelCache = levels;
        },

        async generatePartsList() {
            this.loadingMessage = "Generando niveles...";
            await sleep(50);

            const parts = [];
            const levels = ['jlpt5', 'jlpt4', 'jlpt3', 'jlpt2', 'jlpt1'];

            for (const lvlStr of levels) {
                const lvlNum = parseInt(lvlStr.replace('jlpt', ''));
                
                // Obtener Kanjis (ahora allKanjiData ya tiene la propiedad .jlpt gracias a loadData)
                const kanjisInLevel = Object.keys(this.allKanjiData)
                    .filter(k => this.allKanjiData[k].jlpt === lvlNum)
                    .sort();

                if (kanjisInLevel.length === 0) continue;

                let kpp = MAX_KANJI_PER_PART_DEFAULT;
                if (lvlStr === 'jlpt1') kpp = Math.max(1, Math.ceil(kanjisInLevel.length / TARGET_PARTS_JLPT_N1));
                
                const numParts = Math.ceil(kanjisInLevel.length / kpp);
                
                // Usamos el cache que llenamos en preloadVocabulary
                const vocabGroups = this.vocabByLevelCache[lvlNum] || {};
                
                // Aplanamos grupos para obtener lista lineal
                const allWordsInLevel = Object.values(vocabGroups).flat();
                
                // Filtramos palabras que tengan suficientes distractores (Lógica original)
                const validVocab = allWordsInLevel.filter(w => {
                    const ending = getOkuriganaEnding(w.word);
                    const group = vocabGroups[ending];
                    return group && group.length >= NUM_QUIZ_OPTIONS; 
                });

                const wordsPerPart = Math.ceil(validVocab.length / numParts);

                for (let i = 1; i <= numParts; i++) {
                    const startW = (i - 1) * wordsPerPart;
                    const vocabPart = validVocab.slice(startW, startW + wordsPerPart);

                    parts.push({
                        id: `${lvlStr}_${i}`,
                        name: `JLPT N${lvlNum}`,
                        originalLevel: lvlStr,
                        count: kanjisInLevel.slice((i-1)*kpp, i*kpp).length,
                        kotoba_count: vocabPart.length,
                        kanjiList: kanjisInLevel.slice((i-1)*kpp, i*kpp),
                        fullVocabPart: vocabPart,
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
            this.incorrectlySelectedOptions = [];
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
                
                let corrHira = "", corrType = "", dispComp = "";
                if (kuns.length > 0) {
                    corrHira = kuns[0].split('.')[0]; 
                    corrType = 'kun'; 
                    dispComp = kuns[0].replace('.', '');
                } else if (ons.length > 0) {
                    corrHira = kata2hira(ons[0]); 
                    corrType = 'on'; 
                    dispComp = ons[0];
                } else return null;

                const opts = this.generateKanjiOptions(corrHira, corrType, dispComp, kuns, ons, part.kanjiList, char);
                
                return {
                    kanji: char,
                    meaning: (d.meanings || []).slice(0, 3).join("; "),
                    correct_value: corrHira,
                    correct_contextual_reading: dispComp,
                    options: opts
                };
            }).filter(q => q);
            
            this.startQuiz(queue);
        },

        generateKanjiOptions(correctVal, type, displayComp, kuns, ons, levelList, currentChar) {
            const opts = [{ value: correctVal, display_kun: type === 'kun' ? displayComp : (kuns[0] || '-'), display_on_kata: type === 'on' ? displayComp : (ons[0] || '-') }];
            const pool = shuffleArray(levelList.filter(k => k !== currentChar));

            for (const other of pool) {
                if (opts.length >= NUM_QUIZ_OPTIONS) break;
                const d = this.allKanjiData[other];
                if (!d) continue;
                
                const dk = cleanReadings(d.kun_readings);
                const do_ = cleanReadings(d.on_readings);
                let dist = null;

                if (dk.length > 0) dist = { val: dk[0].split('.')[0], kun: dk[0].replace('.', ''), on: do_[0] || '-' };
                else if (do_.length > 0) dist = { val: kata2hira(do_[0]), kun: '-', on: do_[0] };

                if (dist && !opts.some(o => o.value === dist.val)) {
                    opts.push({ value: dist.val, display_kun: dist.kun, display_on_kata: dist.on });
                }
            }
            return shuffleArray(opts);
        },

        generateVocabQuiz(part) {
            const queue = part.fullVocabPart.map(w => {
                const pool = this.vocabByLevelCache[parseInt(part.originalLevel.replace('jlpt',''))][getOkuriganaEnding(w.word)] || [];
                const dists = pool.filter(x => x.reading !== w.reading && x.reading.length === w.reading.length);
                if (dists.length < NUM_QUIZ_OPTIONS - 1) return null;

                const opts = [{value: w.reading}, ...shuffleArray(dists).slice(0, NUM_QUIZ_OPTIONS-1).map(d => ({value: d.reading}))];
                
                return {
                    word: w.word,
                    correct_value: w.reading,
                    // Adaptado al formato simulado en preloadVocabulary: meanings[0].glosses
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
        },

        checkAnswer(option) {
            if (this.showImmediateCorrectFeedback) return;

            if (option.value === this.currentQuestion.correct_value) {
                this.showImmediateCorrectFeedback = true;
                this.correctCount++;
                const itemKey = this.quizMode === 'kanji' ? this.currentQuestion.kanji : this.currentQuestion.word;
                this.completedSessionItems.add(itemKey);
            } else {
                this.incorrectlySelectedOptions.push(option.value);
                this.wrongCount++;
            }
        },

        nextQuestion() {
            if (this.currentItemOrderIndex < this.totalItemsInLevel - 1) {
                this.currentItemOrderIndex++;
                this.loadQuestion(this.currentItemOrderIndex);
            } else {
                this.resetToMenu();
            }
        },

        getButtonClass(option) {
            if (this.showImmediateCorrectFeedback && option.value === this.currentQuestion.correct_value) {
                return 'btn-success';
            }
            if (this.incorrectlySelectedOptions.includes(option.value)) return 'btn-danger';
            return 'btn-outline-primary';
        },
        
        isItemCompleted(key) {
            return this.completedSessionItems.has(key);
        },

        resetToMenu() {
            this.selectedLevel = null;
            this.currentQuestion = null;
        }
    }
});
