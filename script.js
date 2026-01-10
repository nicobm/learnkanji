// script.js

const globalAllKanjiDataLoaded = typeof ALL_KANJI_DATA_PRESENT !== 'undefined' ? ALL_KANJI_DATA_PRESENT : false;
let initialJsonLoadError = !globalAllKanjiDataLoaded ? "No se pudieron cargar los datos de Kanji desde el servidor." : "";

new Vue({
    el: '#app',
    data: {
        jsonLoadError: initialJsonLoadError || null,
        allKanjiDataAvailable: globalAllKanjiDataLoaded,
        selectedLevel: null,
        selectedLevelDisplay: '',
        quizMode: 'kanji', // 'kanji' o 'kotoba'

        // --- Estado del Quiz de Kanji ---
        correctAnswers: 0,
        incorrectAnswers: 0,
        currentKanji: '',
        currentKanjiMeaning: '',
        correctHiragana: '',
        currentCorrectContextualReading: '',
        japaneseMeaningKanjiForm: '',
        allMeanings: [],
        allKunReadings: [],
        allOnReadings: [],
        currentLevelOrderedKanjis: [],

        // --- Estado del Quiz de Kotoba ---
        currentLevelKotoba: [],
        currentWord: {},
        correctReading: '',
        
        // --- Estado Común del Quiz ---
        options: [],
        isLoading: false,
        quizError: null,
        answeredCorrectly: false,
        showImmediateCorrectFeedback: false,
        incorrectlySelectedOptions: [],
        currentSessionSeenItems: [],
        totalItemsInLevel: 0,
        currentItemOrderIndex: 0,
        
        // --- Estado General de la App ---
        nextKanjiTimeoutId: null,
        levelTrulyCompleted: false,
        jlptCounts: [],
        kanjiListForLevel: [], 
        kotobaListForLevel: [], 
        completedKanjis: [],
        completedKotoba: [], 
    },
    computed: {
        displayMeanings() {
            if (this.quizMode === 'kanji') {
                return this.allMeanings || [];
            }
            if (this.quizMode === 'kotoba' && this.currentWord) {
                return this.currentWord.meanings || [];
            }
            return [];
        },
        totalKanjisInLevel() { return this.totalItemsInLevel }, 
        currentKanjiOrderIndex() { return this.currentItemOrderIndex },
        kanjiSeenInLevelCountDisplay() {
            if (this.totalItemsInLevel === 0) return 0;
            return Math.min(this.currentItemOrderIndex + 1, this.totalItemsInLevel);
        },
        progressPercent() {
            if (this.totalItemsInLevel === 0) return 0;
            return (this.kanjiSeenInLevelCountDisplay / this.totalItemsInLevel) * 100;
        },
        winLossRatio() {
            if (this.totalItemsInLevel === 0) return 100;
            const wins = Math.max(0, this.totalItemsInLevel - this.incorrectAnswers);
            const ratio = (wins / this.totalItemsInLevel) * 100;

            if (this.quizMode === 'kotoba') {
                return ratio.toFixed(1);
            } else {
                return Math.round(ratio);
            }
        },
        japaneseMeaningIsDistinct() {
            if (this.quizMode !== 'kanji' || !this.currentCorrectContextualReading || !this.allKunReadings.length) return false;
            const relevantReading = this.allKunReadings.find(r => r.context === this.currentCorrectContextualReading);
            if (!relevantReading) return false;
            return relevantReading.context !== relevantReading.root;
        },
        orderedGroupedJlptParts() {
            if (!this.jlptCounts || this.jlptCounts.length === 0) return [];
            const groups = this.jlptCounts.reduce((acc, part) => {
                acc[part.originalLevel] = acc[part.originalLevel] || {
                    levelKey: part.originalLevel,
                    displayName: `JLPT N${part.originalLevel.replace('jlpt', '')}`,
                    parts: []
                };
                acc[part.originalLevel].parts.push(part);
                return acc;
            }, {});
            const levelOrder = ['jlpt5', 'jlpt4', 'jlpt3', 'jlpt2', 'jlpt1'];
            return levelOrder.filter(key => groups[key]).map(key => groups[key]);
        },
        // Devuelve clases de Bootstrap para el texto del ratio
        winLossRatioClass() {
            const ratio = parseFloat(this.winLossRatio);
            if (ratio >= 90) return 'text-success fw-bold';
            if (ratio >= 80) return 'text-success fw-semibold';
            if (ratio >= 70) return 'text-warning fw-bold';
            if (ratio >= 60) return 'text-warning fw-semibold';
            if (ratio >= 50) return 'text-danger fw-semibold';
            return 'text-danger fw-bold';
        }
    },
    methods: {
        _clearTimeouts() {
            if (this.nextKanjiTimeoutId) clearTimeout(this.nextKanjiTimeoutId); this.nextKanjiTimeoutId = null;
        },
        _resetQuizProgress() {
            Object.assign(this, {
                correctAnswers: 0, incorrectAnswers: 0, currentSessionSeenItems: [],
                totalItemsInLevel: 0, currentLevelOrderedKanjis: [], currentLevelKotoba: [], currentItemOrderIndex: 0,
                levelTrulyCompleted: false, completedKanjis: [], completedKotoba: []
            });
        },
        _resetCurrentItemState() {
            Object.assign(this, {
                currentKanji: '', currentKanjiMeaning: '', correctHiragana: '',
                currentCorrectContextualReading: '', japaneseMeaningKanjiForm: '',
                allMeanings: [],
                allKunReadings: [], allOnReadings: [],
                currentWord: {}, correctReading: '',
                options: [], quizError: null, answeredCorrectly: false,
                showImmediateCorrectFeedback: false, incorrectlySelectedOptions: []
            });
        },
        resetAppAndQuizState() {
            this._clearTimeouts();
            this._resetQuizProgress();
            this._resetCurrentItemState();
            this.isLoading = false;
        },
        selectLevel(levelId) {
            this.quizMode = 'kanji';
            this.startLevel(levelId, this.loadKanjiData);
        },
        selectKotobaLevel(levelId) {
            this.quizMode = 'kotoba';
            this.startLevel(levelId, this.loadKotobaData);
        },
        startLevel(levelId, loaderFunction) {
            if (this.jsonLoadError && !this.allKanjiDataAvailable && this.jlptCounts.length === 0) {
                console.warn("Selección de nivel bloqueada: Faltan datos JSON."); return;
            }
            this.selectedLevel = levelId;
            const selectedPart = this.jlptCounts.find(part => part.id === levelId);
            const modePrefix = this.quizMode === 'kotoba' ? 'Kotoba: ' : '';
            this.selectedLevelDisplay = selectedPart ? modePrefix + selectedPart.name : `Nivel ${levelId.replace('jlpt', 'N')}`;
            this.resetAppAndQuizState();
            loaderFunction(levelId);
        },
        goBackToLevelSelection() {
            this.resetAppAndQuizState();
            this.selectedLevel = null;
            this.selectedLevelDisplay = '';
            this.kanjiListForLevel = [];
            this.kotobaListForLevel = [];
            this.quizMode = 'kanji';
        },
        async _fetchJson(url, errorPrefix = "Error en fetch") {
            const response = await fetch(url);
            if (!response.ok) {
                let errorDetail = `Error HTTP ${response.status}`;
                try { errorDetail = (await response.json()).error || errorDetail; } catch (e) {}
                throw new Error(`${errorPrefix}: ${errorDetail}`);
            }
            return response.json();
        },
        async loadKanjiData(levelId) {
            this.isLoading = true;
            this.quizError = null;
            try {
                const quizDataList = await this._fetchJson(`/api/level_details/${levelId}`, "Error al cargar datos de kanji");
                if (quizDataList && quizDataList.length > 0) {
                    this.currentLevelOrderedKanjis = quizDataList;
                    this.kanjiListForLevel = quizDataList.map(q => q.kanji);
                    this.totalItemsInLevel = quizDataList.length;
                    this.resetCountersAndStart(this.displayKanjiByIndex);
                } else {
                    this.handleEmptyLevel();
                }
            } catch (error) { this.handleLoadError(error); } 
            finally { this.isLoading = false; }
        },
        async loadKotobaData(levelId) {
            this.isLoading = true;
            this.quizError = null;
            try {
                const kotobaList = await this._fetchJson(`/api/vocabulary/${levelId}`, "Error al cargar kotoba");
                if (kotobaList && kotobaList.length > 0) {
                    this.currentLevelKotoba = kotobaList;
                    this.kotobaListForLevel = kotobaList;
                    this.totalItemsInLevel = kotobaList.length;
                    this.resetCountersAndStart(this.displayKotobaByIndex);
                } else {
                    this.handleEmptyLevel();
                }
            } catch (error) { this.handleLoadError(error); }
             finally { this.isLoading = false; }
        },
        resetCountersAndStart(displayFunction) {
            Object.assign(this, {
                incorrectAnswers: 0, correctAnswers: 0,
                currentSessionSeenItems: [], currentItemOrderIndex: 0, completedKanjis: [], completedKotoba: []
            });
            displayFunction(0);
        },
        handleEmptyLevel() {
            Object.assign(this, { currentLevelOrderedKanjis: [], currentLevelKotoba: [], totalItemsInLevel: 0, quizError: `No hay items para ${this.selectedLevelDisplay}.`, currentKanji:'', currentWord: {}, options:[] });
        },
        handleLoadError(error) {
            console.error("Error en carga de nivel:", error);
            this.quizError = error.message;
            this.handleEmptyLevel();
        },
        displayKanjiByIndex(index) {
            this._resetCurrentItemState();
            if (index < 0 || index >= this.currentLevelOrderedKanjis.length) { this.levelTrulyCompleted = true; return; }
            const data = this.currentLevelOrderedKanjis[index];
            Object.assign(this, {
                currentKanji: data.kanji || '?', correctHiragana: data.hiragana || '', options: data.options || [],
                currentKanjiMeaning: data.meaning || '', currentCorrectContextualReading: data.correct_contextual_reading || '',
                japaneseMeaningKanjiForm: data.japanese_meaning_kanji_form || '',
                allMeanings: data.all_meanings || [],
                allKunReadings: data.all_kun_readings || [], allOnReadings: data.all_on_readings || [],
                isLoading: false 
            });
        },
        displayKotobaByIndex(index) {
            this._resetCurrentItemState();
            if (index < 0 || index >= this.currentLevelKotoba.length) { this.levelTrulyCompleted = true; return; }
            const data = this.currentLevelKotoba[index];
            this.currentWord = data;
            this.correctReading = data.reading;
            this.options = data.options || []; 
            this.isLoading = false;
        },
        async checkAnswer(selectedValue) {
            if (this.isLoading || this.answeredCorrectly || this.levelTrulyCompleted) return;
            if (this.incorrectlySelectedOptions.includes(selectedValue)) return;

            this._clearTimeouts();
            
            const correctAnswer = this.quizMode === 'kanji' ? this.correctHiragana : this.correctReading;
            const currentItemIdentifier = this.quizMode === 'kanji' ? this.currentKanji : this.currentWord.word;

            if (String(selectedValue).trim() === String(correctAnswer).trim()) {
                Object.assign(this, {answeredCorrectly:true, showImmediateCorrectFeedback:true, quizError:null});
                if (!this.currentSessionSeenItems.includes(currentItemIdentifier)) {
                    this.correctAnswers++;
                }

                if (this.quizMode === 'kanji' && !this.completedKanjis.includes(this.currentKanji)) {
                    this.completedKanjis.push(this.currentKanji);
                } else if (this.quizMode === 'kotoba' && !this.completedKotoba.includes(this.currentWord.word)) {
                    this.completedKotoba.push(this.currentWord.word);
                }
                
                if (this.currentItemOrderIndex >= this.totalItemsInLevel - 1) {
                    this.levelTrulyCompleted = true;
                }
            } else {
                if (!this.currentSessionSeenItems.includes(currentItemIdentifier)) {
                    this.incorrectAnswers++;
                    this.currentSessionSeenItems.push(currentItemIdentifier);
                }
                this.incorrectlySelectedOptions.push(selectedValue);
                Object.assign(this, {answeredCorrectly:false, showImmediateCorrectFeedback:false});
            }
        },
        loadNextQuestionAfterCorrect() {
            this.currentItemOrderIndex++;
            const displayFunction = this.quizMode === 'kanji' ? this.displayKanjiByIndex : this.displayKotobaByIndex;
            displayFunction(this.currentItemOrderIndex);
        },
        
        // --- ESTILO DE BOTONES (Consistente con custom.css) ---
        getButtonClass(opt){
            const correctAnswer = this.quizMode === 'kanji' ? this.correctHiragana : this.correctReading;
            
            if (this.answeredCorrectly && opt.value === correctAnswer) {
                return 'btn-success'; 
            }
            if (this.incorrectlySelectedOptions.includes(opt.value)) {
                return 'btn-danger disabled';
            }
            if (this.answeredCorrectly && opt.value !== correctAnswer) {
                return 'btn-outline-secondary disabled border-0 opacity-25';
            }
            return 'btn-option';
        },

        isKanjiCompleted(kanjiChar) {
            return this.completedKanjis.includes(kanjiChar);
        },
        isKotobaCompleted(kotobaWord) {
            return this.completedKotoba.includes(kotobaWord);
        },
        
        // --- LÓGICA DE TEMA AUTOMÁTICO ---
        initAutoTheme() {
            // Función para aplicar tema según el media query
            const applyTheme = (e) => {
                const theme = e.matches ? 'dark' : 'light';
                document.documentElement.setAttribute('data-bs-theme', theme);
            };

            // Detectar preferencia inicial
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            applyTheme(mediaQuery); // Aplicar al inicio

            // Escuchar cambios en vivo (si el usuario cambia el tema del SO)
            mediaQuery.addEventListener('change', applyTheme);
        }
    },
    mounted() {
        this.initAutoTheme();

        const jlptPartsDataScript = document.getElementById('jlpt-parts-data-script');
        if (jlptPartsDataScript && jlptPartsDataScript.textContent.trim()) {
            try {
                const parsedJlptCounts = JSON.parse(jlptPartsDataScript.textContent);
                this.jlptCounts = Array.isArray(parsedJlptCounts) ? parsedJlptCounts : [];
                if (!Array.isArray(parsedJlptCounts)) {
                    console.error("JLPT parts data is not an array:", parsedJlptCounts);
                    if (!this.jsonLoadError) this.jsonLoadError = "Error de formato de datos JLPT.";
                }
            } catch (e) {
                console.error("Error parsing JLPT parts JSON:", e);
                this.jlptCounts = [];
                if (!this.jsonLoadError) this.jsonLoadError = "Error al procesar JSON de JLPT.";
            }
        } else {
            console.warn("JLPT parts data script not found or empty.");
            if (this.allKanjiDataAvailable && !this.jsonLoadError) {
                this.jsonLoadError = "No se encontró el script de datos JLPT.";
            }
        }
        if (!this.jsonLoadError && this.allKanjiDataAvailable && this.jlptCounts.length === 0) {
            this.jsonLoadError = "Datos Kanji OK, pero no se generaron partes JLPT.";
        }
    }
});
