document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('levelForm');
    const gridContainer = document.getElementById('gridContainer');
    const exportBtn = document.getElementById('exportBtn');
    const seedInput = document.getElementById('seed');
    const fileInput = document.getElementById('fileInput');
    const jsonDisplay = document.getElementById('jsonDisplay');
    const jsonContent = document.getElementById('jsonContent');
    const widthInput = document.getElementById('width');
    const heightInput = document.getElementById('height');
    const difficultyInput = document.getElementById('difficulty');

    const widthSlider = document.getElementById('width');
    const heightSlider = document.getElementById('height');
    const difficultySlider = document.getElementById('difficulty');

    const widthValue = document.getElementById('widthValue');
    const heightValue = document.getElementById('heightValue');
    const difficultyValue = document.getElementById('difficultyValue');

    const sidebar = document.getElementById('sidebar');
    const addCarBtn = document.getElementById('addCarBtn');
    const removeCarBtn = document.getElementById('removeCarBtn');
    const setStartBtn = document.getElementById('setStartBtn');
    const setEndBtn = document.getElementById('setEndBtn');

    let cellEditingMode = null;

    addCarBtn.addEventListener('click', function () {
        cellEditingMode = 'addCar';
        updateSidebarButtons();
    });

    removeCarBtn.addEventListener('click', function () {
        cellEditingMode = 'removeCar';
        updateSidebarButtons();
    });

    setStartBtn.addEventListener('click', function () {
        cellEditingMode = 'setStart';
        updateSidebarButtons();
    });

    setEndBtn.addEventListener('click', function () {
        cellEditingMode = 'setEnd';
        updateSidebarButtons();
    });

    gridContainer.addEventListener('click', function (event) {
        const cell = event.target;
        if (cell.classList.contains('cell')) {
            // Get the row index and column index based on the grid layout
            const row = cell.parentElement; // Assuming each row is a direct child of the grid container
            const rowIndex = parseInt(Array.from(row.children).indexOf(cell) / widthInput.value);
            const columnIndex = (Array.from(row.children).indexOf(cell) % heightInput.value);

            switch (cellEditingMode) {
                case 'addCar':
                    addCar(columnIndex, rowIndex);
                    break;
                case 'removeCar':
                    removeCar(columnIndex, rowIndex);
                    break;
                case 'setStart':
                    setStart(columnIndex, rowIndex);
                    break;
                case 'setEnd':
                    setEnd(columnIndex, rowIndex);
                    break;
                default:
                    break;
            }
        }
    });

    // Modify addCar function to check if grid is initialized
    function addCar(x, y) {
        // Check if grid is initialized
        if (generatedLevel.grid) {
            // Check if the cell is already a car
            if (!generatedLevel.cars.some(car => car[0] === x && car[1] === y)) {
                generatedLevel.cars.push([x, y]);
                generatedLevel.grid[y][x] = 'car'; // Update grid type
                displayLevel(generatedLevel);
            }
        } else {
            console.error('Grid is not initialized!');
        }
    }

    function removeCar(x, y) {
        generatedLevel.cars = generatedLevel.cars.filter(car => car[0] !== x || car[1] !== y);
        displayLevel(generatedLevel);
    }

    function setStart(x, y) {
        generatedLevel.start = [x, y];
        displayLevel(generatedLevel);
    }

    function setEnd(x, y) {
        generatedLevel.end = [x, y];
        displayLevel(generatedLevel);
    }

    function updateSidebarButtons() {
        // Reset all buttons
        addCarBtn.classList.remove('active');
        removeCarBtn.classList.remove('active');
        setStartBtn.classList.remove('active');
        setEndBtn.classList.remove('active');

        // Activate the button corresponding to the current cell editing mode
        switch (cellEditingMode) {
            case 'addCar':
                addCarBtn.classList.add('active');
                break;
            case 'removeCar':
                removeCarBtn.classList.add('active');
                break;
            case 'setStart':
                setStartBtn.classList.add('active');
                break;
            case 'setEnd':
                setEndBtn.classList.add('active');
                break;
            default:
                break;
        }
    }


    widthSlider.addEventListener('input', () => {
        widthValue.textContent = widthSlider.value;
    });

    heightSlider.addEventListener('input', () => {
        heightValue.textContent = heightSlider.value;
    });

    difficultySlider.addEventListener('input', () => {
        difficultyValue.textContent = difficultySlider.value;
    });

    let generatedLevel = null;

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);
        const difficulty = parseInt(difficultyInput.value);
        const seed = generateRandomSeed();
        const useDFS = document.getElementById('useDFS').checked;

        seedInput.value = seed;

        Math.seedrandom(seed); // Setting seed for deterministic random number generation

        // Show loading progress bar
        showLoadingProgressBar();

        try {
            const level = await generateLevelAsync(width, height, difficulty, seed, useDFS);
            generatedLevel = level;
            displayLevel(level);
            exportBtn.disabled = false;
        } catch (error) {
            console.error('Error generating level:', error);
            alert('An error occurred while generating the level.');
        } finally {
            // Hide loading progress bar
            hideLoadingProgressBar();
        }
    });

    // Other functions remain the same...

    function showLoadingProgressBar() {
        document.getElementById('loading-bar').style.display = 'block';
    }

    function hideLoadingProgressBar() {
        document.getElementById('loading-bar').style.display = 'none';
    }

    exportBtn.addEventListener('click', function () {
        if (generatedLevel) {
            const jsonData = JSON.stringify(generatedLevel, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = 'level.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    });

    fileInput.addEventListener('change', function (event) {
        const file = event.target.files[0];
        const reader = new FileReader();

        reader.onload = function (e) {
            const contents = e.target.result;
            const level = JSON.parse(contents);

            // Ensure that the grid property is present in the parsed JSON
            if (level.grid) {
                generatedLevel = level;
                // Now generatedLevel.grid is initialized, you can handle other actions accordingly
                widthInput.value = level.width;
                heightInput.value = level.height;
                difficultyInput.value = level.difficulty;
                seedInput.value = level.seed;
                displayLevel(generatedLevel);
            } else {
                console.error('Grid is not present in the JSON file.');
            }
        };

        reader.readAsText(file);
    });


    function generateRandomSeed() {
        return Math.random().toString(36).substr(2, 9); // Generate random alphanumeric string
    }

    async function generateLevelAsync(width, height, difficulty, seed, useDFS) {
        return new Promise((resolve, reject) => {
            setTimeout(() => { // Simulate asynchronous level generation
                const level = generateLevel(width, height, difficulty, seed, useDFS);
                resolve(level);
            }, 100); // Adjust timeout as needed
        });
    }

    function generateLevel(width, height, difficulty, seed, useDFS) {
        const level = {
            width: width,
            height: height,
            difficulty: difficulty,
            start: [Math.floor(Math.random() * width), Math.floor(Math.random() * height)],
            end: [Math.floor(Math.random() * width), Math.floor(Math.random() * height)],
            cars: [],
            seed: seed
        };
        // Initialize grid with 'empty' type for all cells
        level.grid = Array.from({ length: height }, () => Array(width).fill('empty'));

        if (useDFS) {
            // Use DFS to find paths
            const paths = findAllPaths(level, level.start, level.end);

            console.log(paths);

            // Generate cars while avoiding paths
            const totalCells = width * height;
            const numCars = Math.floor((difficulty / 10) * totalCells * 0.5);

            for (let i = 0; i < numCars; i++) {
                let x, y;
                let count = 0;
                do {
                    count++;
                    if (count > 100)
                        break;
                    x = Math.floor(Math.random() * width);
                    y = Math.floor(Math.random() * height);
                } while (level.cars.some(car => car[0] === x && car[1] === y) || paths.every(path => {
                    let currX = level.start[0], currY = level.start[1];
                    for (const direction of path) {
                        switch (direction) {
                            case 'L':
                                currX--;
                                break;
                            case 'R':
                                currX++;
                                break;
                            case 'U':
                                currY--;
                                break;
                            case 'D':
                                currY++;
                                break;
                        }
                        if (currX === x && currY === y) return true;
                    }
                    return false;
                }));
                if (count > 100)
                    break;
                level.cars.push([x, y]);
            }
        } else {
            // Generate cars randomly
            const totalCells = width * height;
            const numCars = Math.floor((difficulty / 10) * totalCells * 0.5);

            for (let i = 0; i < numCars; i++) {
                const x = Math.floor(Math.random() * width);
                const y = Math.floor(Math.random() * height);

                // Ensure cars don't overlap with start or end points
                if ((x !== level.start[0] || y !== level.start[1]) && (x !== level.end[0] || y !== level.end[1])) {
                    level.cars.push([x, y]);
                }
            }
        }

        return level;
    }

    function findAllPaths(level, start, end) {
        const visited = new Set();
        const paths = [];
        dfs(start[0], start[1], '');
        return paths;

        function dfs(x, y, path) {
            if (paths.length > (10 - level.difficulty))
                return;
            if (x < 0 || y < 0 || x >= level.width || y >= level.height || visited.has(`${x},${y}`)) return;
            if (x === end[0] && y === end[1]) {
                paths.push(path);
                return;
            }
            visited.add(`${x},${y}`);
            let unshuffled = ["R", "L", "D", "U"];

            let shuffled = unshuffled
                .map(value => ({ value, sort: Math.random() }))
                .sort((a, b) => a.sort - b.sort)
                .map(({ value }) => value);

            while (shuffled.length > 0) {
                let key = shuffled.pop();
                switch (key) {
                    case "R":
                        dfs(x + 1, y, path + 'R');
                        break;
                    case "L":
                        dfs(x - 1, y, path + 'L');
                        break;
                    case "D":
                        dfs(x, y + 1, path + 'D');
                        break;
                    case "U":
                        dfs(x, y - 1, path + 'U');
                        break;
                }
            }
            visited.delete(`${x},${y}`);
        }
    }

    function displayLevel(level) {
        gridContainer.innerHTML = '';
        gridContainer.style.setProperty('--cols', level.width);

        for (let y = 0; y < level.height; y++) {
            for (let x = 0; x < level.width; x++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                if (x === level.start[0] && y === level.start[1]) {
                    cell.classList.add('start');
                } else if (x === level.end[0] && y === level.end[1]) {
                    cell.classList.add('end');
                } else if (level.cars.some(car => car[0] === x && car[1] === y)) {
                    cell.classList.add('car');
                }
                gridContainer.appendChild(cell);
            }
        }
    }
});
