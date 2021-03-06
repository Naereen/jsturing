/* JavaScript Turing machine emulator
 * Anthony Morphett - awmorp@gmail.com
 * Traduit en français par Lilian Besson - https://github.com/Naereen/jsTuring_fr
 *
 * With contributions from Erez Wanderman
 */

/* Version 2.1 - November 2016 */
/* Uses jquery (1.11.1) */


var nDebugLevel = 0;

var bFullSpeed = false;     /* If true, run at full speed with no delay between steps */

var bIsReset = false;       /* true if the machine has been reset, false if it is or has been running */
var sTape = "";             /* Contents of TM's tape. Stores all cells that have been visited by the head */
var nTapeOffset = 0;        /* the logical position on TM tape of the first character of sTape */
var nHeadPosition = 0;      /* the position of the TM's head on its tape. Initially zero; may be negative if TM moves to left */
var sState = "q0";
var nSteps = 0;
var nVariant = 0; /* Machine variant. 0 = standard infinite tape, 1 = tape infinite in one direction only */
var hRunTimer = null;
var aProgram = new Object();
/* aProgram is a double asociative array, indexed first by state then by symbol.
   Its members are objects with properties newSymbol, action, newState, breakpoint and sourceLineNumber.
*/

var nMaxUndo = 100;  /* Maximum number of undo steps */
var aUndoList = [];
/* aUndoList is an array of 'deltas' in the form {previous-state, direction, previous-symbol}. */

/* Variables for the source line numbering, markers */
var nTextareaLines = -1;
var oTextarea;
var bIsDirty = true;    /* If true, source must be recompiled before running machine */
var oNextLineMarker = $("<div id='NextLineMarker' title='Étape suivante'>Suiv<div id='NextLineMarkerEnd'></div></div>");
var oPrevLineMarker = $("<div id='PrevLineMarker' title='Étape précédente'>Préc<div id='PrevLineMarkerEnd'></div></div>");
var oPrevInstruction = null;
var oNextInstruction = null;

var sPreviousStatusMsg = "";  /* Most recent status message, for flashing alerts */


/* Step(): run the Turing machine for one step. Returns false if the machine is in halt state at the end of the step, true otherwise. */
function Step() {
    if( bIsDirty) Compile();

    bIsReset = false;
    if(( sState.substring(0,4).toLowerCase() == "halt" ) || ( sState.substring(0,4).toLowerCase() == "stop" )) {
        /* debug( 1, "Warning: Step() called while in halt state" ); */
        SetStatusMessage( "Arrêté." );
        notifyUser( "Arrêté." );
        EnableControls( false, false, false, true, true, true, true );
        return( false );
    }

    var sNewState, sNewSymbol, nAction, nLineNumber;

    /* Get current symbol */
    var sHeadSymbol = GetTapeSymbol( nHeadPosition );

    /* Find appropriate TM instruction */
    var oInstruction = GetNextInstruction( sState, sHeadSymbol );

    if( oInstruction != null ) {
        sNewState = (oInstruction.newState == "*" ? sState : oInstruction.newState);
        sNewSymbol = (oInstruction.newSymbol == "*" ? sHeadSymbol : oInstruction.newSymbol);
        nAction = (((oInstruction.action.toLowerCase() == "r") || (oInstruction.action.toLowerCase() == "d")) ? 1 : (((oInstruction.action.toLowerCase() == "l") || (oInstruction.action.toLowerCase() == "g")) ? -1 : 0));
    if( nVariant == 1 && nHeadPosition == 0 && nAction == -1 ) {
      nAction = 0;  /* Can't move left when already at left-most tape cell. */
    }
        nLineNumber = oInstruction.sourceLineNumber;
    } else {
        /* No matching rule found; halt */
        debug( 1, "Warning: no instruction found for state '" + sState + "' symbol '" + sHeadSymbol + "'; halting" );
        SetStatusMessage( "Arrêté. Aucune règle pour l'état '" + sState + "' et le symbole '" + sHeadSymbol + "'.", 2 );
        notifyUser( "Arrêté. Aucune règle pour l'état '" + sState + "' et le symbole '" + sHeadSymbol + "'.", 2 );
        sNewState = "halt";
        sNewSymbol = sHeadSymbol;
        nAction = 0;
        nLineNumber = -1;
    }

    /* Save undo information */
  if( nMaxUndo > 0 ) {
    if( aUndoList.length >= nMaxUndo ) aUndoList.shift();  /* Discard oldest undo entry */
    aUndoList.push({state: sState, position: nHeadPosition, symbol: sHeadSymbol});
  }

    /* Update machine tape & state */
    SetTapeSymbol( nHeadPosition, sNewSymbol );
    sState = sNewState;
    nHeadPosition += nAction;

    nSteps++;

    oPrevInstruction = oInstruction;
    oNextInstruction = GetNextInstruction( sNewState, GetTapeSymbol( nHeadPosition ) );

    debug( 4, "Step() finished. New tape: '" + sTape + "'  new state: '" + sState + "'  action: " + nAction + "  line number: " + nLineNumber  );
    UpdateInterface();

    if( (sNewState.substring(0,4).toLowerCase() == "halt") || (sNewState.substring(0,4).toLowerCase() == "stop") ) {
        if( oInstruction != null ) {
            SetStatusMessage( "Arrêté." );
            notifyUser( "Arrêté." );
        }
        EnableControls( false, false, false, true, true, true, true );
        return( false );
    } else {
        if( oInstruction.breakpoint ) {
            SetStatusMessage( "Stoppé au point d'arrêt à la ligne " + (nLineNumber+1) );
            notifyUser( "Stoppé au point d'arrêt à la ligne " + (nLineNumber+1) );
            EnableControls( true, true, false, true, true, true, true );
            return( false );
        } else {
            return( true );
        }
    }
}

/* Undo(): undo a single step of the machine */
function Undo() {
  var oUndoData = aUndoList.pop();
  if( oUndoData ) {
    nSteps--;
    sState = oUndoData.state;
    nHeadPosition = oUndoData.position;
    SetTapeSymbol( nHeadPosition, oUndoData.symbol );
    oPrevInstruction = null;
    oNextInstruction = GetNextInstruction( sState, oUndoData.symbol );
    debug( 3, "Undone one step. New state: '" + sState + "' position : " + nHeadPosition + " symbol: '" + oUndoData.symbol + "'" );
    EnableControls( true, true, false, true, true, true, true );
    SetStatusMessage( "Une étape annulée." /*+ (aUndoList.length == 0 ? " Plus aucune étape précédente n'est disponible." : " (" + aUndoList.length + " remaining)")*/ );
    UpdateInterface();
  } else {
    debug( 1, "Warning: Tried to undo with no undo data available!" );
  }
}


/* Run(): run the TM until it halts or until user interrupts it */
function Run() {
  var bContinue = true;
  if( bFullSpeed ) {
    /* Run 25 steps at a time in fast mode */
    for( var i = 0; bContinue && i < 25; i++ ) {
      bContinue = Step();
    }
    if( bContinue ) hRunTimer = window.setTimeout( Run, 10 );
    else UpdateInterface();   /* Sometimes updates get lost at full speed... */
  } else {
    /* Run a single step every 50ms in slow mode */
    if( Step() ) {
      hRunTimer = window.setTimeout( Run, 50 );
    }
  }
}

/* RunStep(): triggered by the run timer. Calls Step(); stops running if Step() returns false. */
function RunStep() {
    if( !Step() ) {
        StopTimer();
    }
}

/* StopTimer(): Deactivate the run timer. */
function StopTimer() {
    if( hRunTimer != null ) {
        window.clearInterval( hRunTimer );
        hRunTimer = null;
    }
}


/* Reset( ): re-initialise the TM */
function Reset() {
    var sInitialTape = $("#InitialInput")[0].value;

    /* Find the initial head location, if given */
    nHeadPosition = sInitialTape.indexOf( "*" );
    if( nHeadPosition == -1 ) nHeadPosition = 0;

    /* Initialise tape */
    sInitialTape = sInitialTape.replace( /\*/g, "" ).replace( / /g, "_" );
    if( sInitialTape == "" ) sInitialTape = " ";
    sTape = sInitialTape;
    nTapeOffset = 0;

    /* Initialise state */
    var sInitialState = $("#InitialState")[0].value;
    sInitialState = $.trim( sInitialState ).split(/\s+/)[0];
    if( !sInitialState || sInitialState == "" ) sInitialState = "q0";
    sState = sInitialState;

    /* Initialise variant */
  var dropdown = $("#MachineVariant")[0];
  nVariant = Number(dropdown.options[dropdown.selectedIndex].value);
  SetupVariantCSS();

    nSteps = 0;
    bIsReset = true;

    Compile();
    oPrevInstruction = null;
    oNextInstruction = GetNextInstruction( sState, GetTapeSymbol( nHeadPosition ) );

    aUndoList = [];

    EnableControls( true, true, false, true, true, true, false );
    UpdateInterface();
}

/* Compile(): parse the inputted program and store it in aProgram */
function Compile() {
    var sSource = oTextarea.value;
    debug( 2, "Compile()" );

    /* Clear syntax error messages */
    SetSyntaxMessage( null );
    ClearErrorLines();

    /* clear the old program */
    aProgram = new Object;

    sSource = sSource.replace( /\r/g, "" ); /* Internet Explorer uses \n\r, other browsers use \n */

    var aLines = sSource.split("\n");
    for( var i = 0; i < aLines.length; i++ )
    {
        var oTuple = ParseLine( aLines[i], i );
        if( oTuple.isValid ) {
            debug( 5, " Parsed tuple: '" + oTuple.currentState + "'  '" + oTuple.currentSymbol + "'  '" + oTuple.newSymbol + "'  '" + oTuple.action + "'  '" + oTuple.newState + "'" );
            if( aProgram[oTuple.currentState] == null ) aProgram[oTuple.currentState] = new Object;
            if( aProgram[oTuple.currentState][oTuple.currentSymbol] != null ) {
                debug( 1, "Warning: multiple definitions for state '" + oTuple.currentState + "' symbol '" + oTuple.currentSymbol + "' on lines " + (aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber+1) + " and " + (i+1) );
                SetSyntaxMessage( "Attention : plusieurs transitions définies pour l'état '" + oTuple.currentState + "' et le symbole '" + oTuple.currentSymbol + "', aux lignes " + (aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber+1) + " et " + (i+1) + "." );
                SetErrorLine( i );
                SetErrorLine( aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber );


            }
            aProgram[oTuple.currentState][oTuple.currentSymbol] = new Object;
            aProgram[oTuple.currentState][oTuple.currentSymbol].newSymbol = oTuple.newSymbol;
            aProgram[oTuple.currentState][oTuple.currentSymbol].action = oTuple.action;
            aProgram[oTuple.currentState][oTuple.currentSymbol].newState = oTuple.newState;
            aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber = i;
            aProgram[oTuple.currentState][oTuple.currentSymbol].breakpoint = oTuple.breakpoint;
        }
        else if( oTuple.error )
        {
            /* Syntax error */
            debug( 2, "Syntax error: " + oTuple.error );
            SetSyntaxMessage( oTuple.error );
            SetErrorLine( i );
        }
    }

    /* Set debug level, if specified */
    oRegExp = new RegExp( ";.*\\$DEBUG: *(.+)" );
    aResult = oRegExp.exec( sSource );
    if( aResult != null && aResult.length >= 2 ) {
        var nNewDebugLevel = parseInt( aResult[1] );
        if( nNewDebugLevel != nDebugLevel ) {
            nDebugLevel = parseInt( aResult[1] );
            debug( 1, "Setting debug level to " + nDebugLevel );
            if( nDebugLevel > 0 ) $(".DebugClass").toggle( true );
        }
    }

    /* Lines have changed. Previous line is no longer meaningful, recalculate next line. */
    oPrevInstruction = null;
    oNextInstruction = GetNextInstruction( sState, GetTapeSymbol( nHeadPosition ) );

    bIsDirty = false;

    UpdateInterface();
}

function ParseLine( sLine, nLineNum )
{
    /* discard anything following ';' */
    debug( 5, "ParseLine( " + sLine + " )" );
    sLine = sLine.split( ";", 1 )[0];

    /* split into tokens - separated by tab or space */
    var aTokens = sLine.split(/\s+/);
    aTokens = aTokens.filter( function (arg) { return( arg != "" ) ;} );
/*  debug( 5, " aTokens.length: " + aTokens.length );
    for( var j in aTokens ) {
        debug( 1, "  aTokens[ " + j + " ] = '" + aTokens[j] + "'" );
    }*/

    var oTuple = new Object;

    if( aTokens.length == 0 )
    {
        /* Blank or comment line */
        oTuple.isValid = false;
        return( oTuple );
    }

    oTuple.currentState = aTokens[0];

    if( aTokens.length < 2 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": il manque &lt;le symbole courant&gt; !" ;
        return( oTuple );
    }
    if( aTokens[1].length > 1 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": &lt;le symbole courant&gt; devrait être UN SEUL symbole !" ;
        return( oTuple );
    }
    oTuple.currentSymbol = aTokens[1];

    if( aTokens.length < 3 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": il manque &lt;le nouveau symbole&gt;!" ;
        return( oTuple );
    }
    if( aTokens[2].length > 1 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": &lt;le nouveau symbole&gt; devrait être UN SEUL symbole !" ;
        return( oTuple );
    }
    oTuple.newSymbol = aTokens[2];

    if( aTokens.length < 4 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": il manque &lt;la direction&gt;!" ;
        return( oTuple );
    }
    if( ["l", "g", "r", "d", "*"].indexOf( aTokens[3].toLowerCase() ) < 0 ) {
        // FIXME change l and r to g and d
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": &lt;la direction&gt; doit être 'l' ou 'g' (pour gauche), ou 'r' ou 'd' (pour droite) ou '*' (pour rester sur place) !";
        return( oTuple );
    }
    oTuple.action = aTokens[3].toLowerCase();

    if( aTokens.length < 5 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": il manque &lt;le nouveau état&gt;!" ;
        return( oTuple );
    }
    oTuple.newState = aTokens[4];

    if( aTokens.length > 6 ) {
        oTuple.isValid = false;
        oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": trop de valeurs sur cette ligne (il faut 5 ou 6 valeurs) !" ;
        return( oTuple );
    }
    if( aTokens.length == 6 ) {     /* Anything other than '!' in position 6 is an error */
        if( aTokens[5] == "!" ) {
            oTuple.breakpoint = true;
        } else {
            oTuple.isValid = false;
            oTuple.error = "Erreur de syntaxe à la ligne " + (nLineNum + 1) + ": trop de valeurs sur cette ligne (seul un ! est autorisé en 6ème position) !";
            return( oTuple );
        }
    } else {
        oTuple.breakpoint = false;
    }

    oTuple.isValid = true;
    return( oTuple );
}

/* GetNextInstruction(): look up the next instruction for the given state and symbol */
function GetNextInstruction(sState, sHeadSymbol)
{
    if( aProgram[sState] != null && aProgram[sState][sHeadSymbol] != null ) {
        /* Use instruction specifically corresponding to current state & symbol, if any */
        return( aProgram[sState][sHeadSymbol] );
    } else if( aProgram[sState] != null && aProgram[sState]["*"] != null ) {
        /* Next use rule for the current state and default symbol, if any */
        return( aProgram[sState]["*"] );
    } else if( aProgram["*"] != null && aProgram["*"][sHeadSymbol] != null ) {
        /* Next use rule for default state and current symbol, if any */
        return( aProgram["*"][sHeadSymbol] );
    } else if( aProgram["*"] != null && aProgram["*"]["*"] != null ) {
        /* Finally use rule for default state and default symbol */
        return( aProgram["*"]["*"] );
    } else return( null );
}

/* GetTapeSymbol( n ): returns the symbol at cell n of the TM tape */
function GetTapeSymbol( n )
{
    if( n < nTapeOffset || n >= sTape.length + nTapeOffset ) {
        debug( 4, "GetTapeSymbol( " + n + " ) = '" + c + "'   outside sTape range" );
        return( "_" );
    } else {
        var c = sTape.charAt( n - nTapeOffset );
        if( c == " " ) { c = "_"; debug( 4, "Warning: GetTapeSymbol() got SPACE not _ !" ); }
        debug( 4, "GetTapeSymbol( " + n + " ) = '" + c + "'" );
        return( c );
    }
}


/* SetTapeSymbol( n, c ): writes symbol c to cell n of the TM tape */
function SetTapeSymbol( n, c )
{
    debug( 4, "SetTapeSymbol( " + n + ", " + c + " ); sTape = '" + sTape + "' nTapeOffset = " + nTapeOffset );
    if( c == " " ) { c = "_"; debug( 4, "Warning: SetTapeSymbol() with SPACE not _ !" ); }

    if( n < nTapeOffset ) {
        sTape = c + repeat( "_", nTapeOffset - n - 1 ) + sTape;
        nTapeOffset = n;
    } else if( n > nTapeOffset + sTape.length ) {
        sTape = sTape + repeat( "_", nTapeOffset + sTape.length - n - 1 ) + c;
    } else {
        sTape = sTape.substr( 0, n - nTapeOffset ) + c + sTape.substr( n - nTapeOffset + 1 );
    }
}


/* SaveMachineSnapshot(): Store the current machine and state as an object suitable for saving as JSON */
function SaveMachineSnapshot() {
    return( {
        "program":      oTextarea.value,
        "state":        sState,
        "tape":         sTape,
        "tapeoffset":   nTapeOffset,
        "headposition": nHeadPosition,
        "steps":        nSteps,
        "initialtape":  $("#InitialInput")[0].value,
        "initialstate": $("#InitialState")[0].value,
        "fullspeed":    bFullSpeed,
        "variant":      nVariant,
        "version":      1       /* Internal version number */
    });
}

/* LoadMachineState(): Load a machine and state from an object created by SaveMachineSnapshot */
function LoadMachineSnapshot( oObj )
{
    if( oObj.version && oObj.version != 1 ) debug( 1, "Warning: saved machine has unknown version number " + oObj.version );
    if( oObj.program ) oTextarea.value = oObj.program;
    if( oObj.state ) sState = oObj.state;
    if( oObj.tape ) sTape = oObj.tape;
    if( oObj.tapeoffset ) nTapeOffset = oObj.tapeoffset;
    if( oObj.headposition ) nHeadPosition = oObj.headposition;
    if( oObj.steps ) nSteps = oObj.steps;
    if( oObj.initialtape ) $("#InitialInput")[0].value = oObj.initialtape;
    if( oObj.initialstate ) {
        $("#InitialState")[0].value = oObj.initialstate;
    } else {
        $("#InitialState")[0].value = "";
    }
    if( oObj.fullspeed ) {
        $("#SpeedCheckbox")[0].checked = oObj.fullspeed;
        bFullSpeed = oObj.fullspeed;
    }
    if( oObj.variant ) {
      nVariant = oObj.variant;
    } else {
    nVariant = 0;
    }
    $("#MachineVariant").val(nVariant);
    VariantChanged();
    SetupVariantCSS();
    aUndoList = [];
    if( (sState.substring(0,4).toLowerCase() == "halt") || (sNewState.substring(0,4).toLowerCase() == "stop") ) {
        SetStatusMessage( "Machine chargée. Arrêtée.", 1 );
        notifyUser( "Machine chargée. Arrêtée.", 1 );
        EnableControls( false, false, false, true, true, true, true );
    } else {
        SetStatusMessage( "Machine chargée et prête.", 1  );
        notifyUser( "Machine chargée et prête.", 1  );
        EnableControls( true, true, false, true, true, true, true );
    }
    TextareaChanged();
    Compile();
    UpdateInterface();
}


/* SetStatusMessage(): display sString in the status message area */
/* nBgFlash: 1: flash green for success; 2: flash red for failure; -1: do not flash, even if repeating a message */
function SetStatusMessage( sString, nBgFlash )
{
    $( "#MachineStatusMsgText" ).html( sString );
    if( nBgFlash > 0 ) {
        $("#MachineStatusMsgBg").stop(true, true).css("background-color",(nBgFlash==1?"#c9f2c9":"#ffb3b3")).show().fadeOut(600);
    }
    if( sString != "" && sPreviousStatusMsg == sString && nBgFlash != -1 ) {
        $("#MachineStatusMsgBg").stop(true, true).css("background-color","#bbf8ff").show().fadeOut(600);
    }
    if( sString != "" ) sPreviousStatusMsg = sString;
}

/* SetSyntaxMessage(): display a syntax error message in the textarea */
function SetSyntaxMessage( msg )
{
    $("#SyntaxMsg").html( (msg?msg:"&nbsp;") );
}

/* RenderTape(): show the tape contents and head position in the MachineTape div */
function RenderTape() {
    /* calculate the strings:
      sFirstPart is the portion of the tape to the left of the head
      sHeadSymbol is the symbol under the head
      sSecondPart is the portion of the tape to the right of the head
    */
    var nTranslatedHeadPosition = nHeadPosition - nTapeOffset;  /* position of the head relative to sTape */
    var sFirstPart, sHeadSymbol, sSecondPart;
    debug( 4, "RenderTape: translated head pos: " + nTranslatedHeadPosition + "  head pos: " + nHeadPosition + "  tape offset: " + nTapeOffset );
    debug( 4, "RenderTape: sTape = '" + sTape + "'" );

    if( nTranslatedHeadPosition > 0 ) {
        sFirstPart = sTape.substr( 0, nTranslatedHeadPosition );
    } else {
        sFirstPart = "";
    }
    if( nTranslatedHeadPosition > sTape.length ) {  /* Need to append blanks to sFirstPart.  Shouldn't happen but just in case. */
        sFirstPart += repeat( " ", nTranslatedHeadPosition - sTape.length );
    }
    sFirstPart = sFirstPart.replace( /_/g, " " );

    if( nTranslatedHeadPosition >= 0 && nTranslatedHeadPosition < sTape.length ) {
        sHeadSymbol = sTape.charAt( nTranslatedHeadPosition );
    } else {
        sHeadSymbol = " ";  /* Shouldn't happen but just in case */
    }
    sHeadSymbol = sHeadSymbol.replace( /_/g, " " );

    if( nTranslatedHeadPosition >= 0 && nTranslatedHeadPosition < sTape.length - 1 ) {
        sSecondPart = sTape.substr( nTranslatedHeadPosition + 1 );
    } else if( nTranslatedHeadPosition < 0 ) {  /* Need to prepend blanks to sSecondPart. Shouldn't happen but just in case. */
        sSecondPart = repeat( " ", -nTranslatedHeadPosition - 1 ) + sTape;
    } else {  /* nTranslatedHeadPosition > sTape.length */
        sSecondPart = "";
    }
    sSecondPart = sSecondPart.replace( /_/g, " " );

    debug( 4, "RenderTape: sFirstPart = '" + sFirstPart + "' sHeadSymbol = '" + sHeadSymbol + "'  sSecondPart = '" + sSecondPart + "'" );

    /* Display the parts of the tape */
    $("#LeftTape").text( sFirstPart );
    $("#ActiveTape").text( sHeadSymbol );
    $("#RightTape").text( sSecondPart );
//  debug( 4, "RenderTape(): LeftTape = '" + $("#LeftTape").text() + "' ActiveTape = '" + $("#ActiveTape").text() + "' RightTape = '" + $("#RightTape").text() + "'" );

    /* Scroll tape display to make sure that head is visible */
    if( $("#ActiveTapeArea").position().left < 0 ) {
        $("#MachineTape").scrollLeft( $("#MachineTape").scrollLeft() + $("#ActiveTapeArea").position().left - 10 );
    } else if( $("#ActiveTapeArea").position().left + $("#ActiveTapeArea").width() > $("#MachineTape").width() ) {
        $("#MachineTape").scrollLeft( $("#MachineTape").scrollLeft() + ($("#ActiveTapeArea").position().left - $("#MachineTape").width()) + 10 );
    }
}

function RenderState() {
    $("#MachineState").html( sState );
}

function RenderSteps() {
    $("#MachineSteps").html( nSteps );
}

function RenderLineMarkers() {
    debug( 3, "Rendering line markers: " + (oNextInstruction?oNextInstruction.sourceLineNumber:-1) + " " + (oPrevInstruction?oPrevInstruction.sourceLineNumber:-1) );
    SetActiveLines( (oNextInstruction?oNextInstruction.sourceLineNumber:-1), (oPrevInstruction?oPrevInstruction.sourceLineNumber:-1) );
}

/* UpdateInterface(): refresh the tape, state and steps displayed on the page */
function UpdateInterface() {
    RenderTape();
    RenderState();
    RenderSteps();
    RenderLineMarkers();
}

function ClearDebug() {
    $("#debug").empty();
}

function EnableControls( bStep, bRun, bStop, bReset, bSpeed, bTextarea, bUndo )
{
  document.getElementById( 'StepButton' ).disabled = !bStep;
  document.getElementById( 'RunButton' ).disabled = !bRun;
  document.getElementById( 'StopButton' ).disabled = !bStop;
  document.getElementById( 'ResetButton' ).disabled = !bReset;
  document.getElementById( 'SpeedCheckbox' ).disabled = !bSpeed;
  document.getElementById( 'Source' ).disabled = !bTextarea;
  EnableUndoButton(bUndo);
  if( bSpeed ) {
    $( "#SpeedCheckboxLabel" ).removeClass( "disabled" );
  } else {
    $( "#SpeedCheckboxLabel" ).addClass( "disabled" );
  }
}

function EnableUndoButton(bUndo)
{
  document.getElementById( 'UndoButton' ).disabled = !(bUndo && aUndoList.length > 0);
}

/* Trigger functions for the buttons */

function StepButton() {
    SetStatusMessage( "", -1 );
    Step();
    EnableUndoButton(true);
}

function RunButton() {
    SetStatusMessage( "Calcul en cours..." );
    /* Make sure that the step interval is up-to-date */
    SpeedCheckbox();
    EnableControls( false, false, true, false, false, false, false );
    Run();
}

function StopButton() {
    if( hRunTimer != null ) {
        SetStatusMessage( "Pausé; cliquez 'Lancer' ou 'Étape' pour continuer." );
        notifyUser( "Pausé; cliquez 'Lancer' ou 'Étape' pour continuer." );
        EnableControls( true, true, false, true, true, true, true );
        StopTimer();
    }
}

function ResetButton() {
    SetStatusMessage( "Machine réinitialisée. Cliquez 'Lancer' ou 'Étape' pour commencer." );
    notifyUser( "Machine réinitialisée. Cliquez 'Lancer' ou 'Étape' pour commencer." );
    Reset();
    EnableControls( true, true, false, true, true, true, false );
}

function SpeedCheckbox() {
  bFullSpeed = $( '#SpeedCheckbox' )[0].checked;
}

function VariantChanged() {
  var dropdown = $("#MachineVariant")[0];
  selected = Number(dropdown.options[dropdown.selectedIndex].value);
  var descriptions = {
    0: "Machine de Turing standard, avec un ruban infini dans les deux directions.",
    1: "Machine de Turing avec un ruban infini dans seulement une direction (utilisée et décrite notamment dans le livre par <a href='http://math.mit.edu/~sipser/book.html'>Michael Sipser</a>)."
  };
  $("#MachineVariantDescription").html( descriptions[selected] );
}

function SetupVariantCSS() {
  if( nVariant == 1 ) {
    $("#LeftTape").addClass( "OneDirectionalTape" );
  } else {
    $("#LeftTape").removeClass( "OneDirectionalTape" );
  }
}

function LoadFromCloud( sID )
{
    /* Get data from github */
    $.ajax({
        url: "https://api.github.com/gists/" + sID,
        type: "GET",
        dataType: "json",
        success: loadSuccessCallback,
        error: loadErrorCallback
    });
}

function loadSuccessCallback( oData )
{
    if( !oData || !oData.files || !oData.files["machine.json"] || !oData.files["machine.json"].content ) {
        debug( 1, "Error: Load AJAX request succeeded but can't find expected data." );
        SetStatusMessage( "Erreur lors du chargement de la machine sauvegardée :( :(", 2 );
        notifyUser( "Erreur lors du chargement de la machine sauvegardée :( :(", 2 );
        return;
    }
    var oUnpackedObject;
    try {
        oUnpackedObject = JSON.parse( oData.files["machine.json"].content );
    } catch( e ) {
        debug( 1, "Error: Exception when unpacking JSON: " + e );
        SetStatusMessage( "Erreur lors du chargement de la machine sauvegardée :( :(", 2 );
        notifyUser( "Erreur lors du chargement de la machine sauvegardée :( :(", 2 );
        return;
    }
    LoadMachineSnapshot( oUnpackedObject );
}

function loadErrorCallback( oData, sStatus, oRequestObj )
{
    debug( 1, "Error: Load failed. AJAX request to Github failed. HTTP response " + oRequestObj );
    SetStatusMessage( "Erreur lors du chargement de la machine sauvegardée :( :(", 2 );
    notifyUser( "Erreur lors du chargement de la machine sauvegardée :( :(", 2 );
}

function SaveToCloud() {
    SetSaveMessage( "Saving...", null );
    var oUnpackedObject = SaveMachineSnapshot();
    var gistApiInput = {
        "description": "État d'une machine de Turing machine sauvegardé depuis https://naereen.github.io/jsTuring_fr/turing.html",
        "public": false,
        "files": {
            "machine.json": {
                "content": JSON.stringify( oUnpackedObject )
            }
        }
    };
    $.ajax({
        url: "https://api.github.com/gists",
        type: "POST",
        data: JSON.stringify(gistApiInput),
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: saveSuccessCallback,
        error: saveErrorCallback
    });
}

function saveSuccessCallback( oData )
{
    if( oData && oData.id ) {
        var sURL = window.location.href.replace(/[\#\?].*/,"");     /* Strip off any hash or query parameters, ie "?12345678" */
        sURL += "?" + oData.id;                                 /* Append gist id as query string */
        //var sURL = "https://naereen.github.io/jsTuring_fr/turing.html" + "?" + oData.id;
        debug( 1, "Save successful. Gist ID is " + oData.id + " Gist URL is " + oData.url /*+ ", user URL is " + sURL */ );

        var oNow = new Date();

        var sTimestamp = (oNow.getHours() < 10 ? "0" + oNow.getHours() : oNow.getHours()) + ":" + (oNow.getMinutes() < 10 ? "0" + oNow.getMinutes() : oNow.getMinutes()) + ":" + (oNow.getSeconds() < 10 ? "0" + oNow.getSeconds() : oNow.getSeconds());/* + " " + oNow.toLocaleDateString();*/

        SetSaveMessage( "Saved! Your URL is <br><a href=" + sURL + ">" + sURL + "</a><br>Bookmark or share this link to access your saved machine.<br><span style='font-size: small; font-style: italic;'>Last saved at " + sTimestamp + "</span>", 1 );

    } else {
        debug( 1, "Error: Save failed. Missing data or id from Github response." );
        SetSaveMessage( "Save failed, sorry :(", 2 );
    }
}

function saveErrorCallback( oData, sStatus, oRequestObj )
{
    debug( 1, "Error: Save failed. AJAX request to Github failed. HTTP response " + oRequestObj.status + " " + oRequestObj.statusText );
    SetSaveMessage( "Save failed, sorry :(", 2 );
}

function SetSaveMessage( sStr, nBgFlash )
{
    $("#SaveStatusMsg").html( sStr );
    $("#SaveStatus").slideDown();
    if( nBgFlash ) {    /* Flash background of notification */
        $("#SaveStatusBg").stop(true, true).css("background-color",(nBgFlash==1?"#88ee99":"#eb8888")).show().fadeOut(800);
    }
}

function ClearSaveMessage() {
    $("#SaveStatusMsg").empty();
    $("#SaveStatus").hide();
}

function LoadSampleProgram( zName, zFriendlyName, bInitial )
{
    debug( 1, "Load '" + zName + "'" );
    SetStatusMessage( "Chargement du programme d'exemple..." );
    var zFileName = "machines/" + zName + ".txt";

    StopTimer();   /* Stop machine, if currently running */

    $.ajax({
        url: zFileName,
        type: "GET",
        dataType: "text",
        success: function( sData, sStatus, oRequestObj ) {
            /* Load the default initial tape, if any */
            // var oRegExp = new RegExp( "\\$INITIAL_TAPE:? *(.+)$" );
            var oRegExp = new RegExp( ";.*\\$INITIAL_TAPE:? *(.+)$" );
            var aRegexpResult = oRegExp.exec( sData );
            if( aRegexpResult != null && aRegexpResult.length >= 2 ) {
                debug( 4, "Parsed initial tape: '" + aRegexpResult + "' length: " + (aRegexpResult == null ? "null" : aRegexpResult.length) );
                $("#InitialInput")[0].value = aRegexpResult[1];
                // sData = sData.replace( /^.*\$INITIAL_TAPE:.*$/m, "" );
            }
            $("#InitialState")[0].value = "q0";
            nVariant = 0;
            $("#MachineVariant").val(0);
            VariantChanged();
            /* TODO: Set up CSS */

            /* Load the program */
            oTextarea.value = sData;
            TextareaChanged();
            Compile();

            /* Reset the machine  */
            Reset();
            if( !bInitial ) {
                SetStatusMessage( zFriendlyName + " bien chargée", 1 );
                notifyUser( zFriendlyName + " bien chargée", 1 );
            }
        },
        error: function( oData, sStatus, oRequestObj ) {
            debug( 1, "Error: Load failed. HTTP response " + oRequestObj.status + " " + oRequestObj.statusText );
            SetStatusMessage( "Erreur en chargeant " + zFriendlyName + " :(", 2 );
            notifyUser( "Erreur en chargeant " + zFriendlyName + " :(", 2 );
        }
    });

    $("#LoadMenu").slideUp();
    ClearSaveMessage();
}

/* onchange function for textarea */
function TextareaChanged() {
    /* Update line numbers only if number of lines has changed */
    var nNewLines = (oTextarea.value.match(/\n/g) ? oTextarea.value.match(/\n/g).length : 0) + 1;
    if( nNewLines != nTextareaLines ) {
        nTextareaLines = nNewLines
        UpdateTextareaDecorations();
    }

//  Compile();
    bIsDirty = true;
    oPrevInstruction = null;
    oNextInstruction = null;
    RenderLineMarkers();
}

/* Generate line numbers for each line in the textarea */
function UpdateTextareaDecorations() {
    var oBackgroundDiv = $("#SourceBackground");

    oBackgroundDiv.empty();

    var sSource = oTextarea.value;
    sSource = sSource.replace( /\r/g, "" ); /* Internet Explorer uses \n\r, other browsers use \n */

    var aLines = sSource.split("\n");

    for( var i = 0; i < aLines.length; i++)
    {
        oBackgroundDiv.append($("<div id='talinebg"+(i+1)+"' class='talinebg'><div class='talinenum'>"+(i+1)+"</div></div>"));
    }

    UpdateTextareaScroll();
}

/* Highlight given lines as the next/previous tuple */
function SetActiveLines( next, prev )
{
    $(".talinebgnext").removeClass('talinebgnext');
    oNextLineMarker.detach().removeClass('shifted');
    $(".talinebgprev").removeClass('talinebgprev');
    oPrevLineMarker.detach().removeClass('shifted');

    if( next >= 0 )
    {
        $("#talinebg"+(next+1)).addClass('talinebgnext').prepend(oNextLineMarker);
    }
    if( prev >= 0)
    {
        if( prev != next ) {
            $("#talinebg"+(prev+1)).addClass('talinebgprev').prepend(oPrevLineMarker);
        } else {
            $("#talinebg"+(prev+1)).prepend(oPrevLineMarker);
            oNextLineMarker.addClass('shifted');
            oPrevLineMarker.addClass('shifted');

        }
    }
}

/* Highlight given line as an error */
function SetErrorLine( num )
{
    $("#talinebg"+(num+1)).addClass('talinebgerror');
}

/* Clear error highlights from all lines */
function ClearErrorLines() {
    $(".talinebg").removeClass('talinebgerror');
}

/* Update the line numbers when textarea is scrolled */
function UpdateTextareaScroll() {
    var oBackgroundDiv = $("#SourceBackground");

    $(oBackgroundDiv).css( {'margin-top': (-1*$(oTextarea).scrollTop()) + "px"} );
}


function AboutMenuClicked( name )
{
    $(".AboutItem").css( "font-weight", "normal" );
    $("#AboutItem" + name).css( "font-weight", "bold" );

    $(".AboutContent").slideUp({queue: false, duration: 150}).fadeOut(150);
    $("#AboutContent" + name ).stop().detach().prependTo("#AboutContentContainer").fadeIn({queue: false, duration: 150}).css("display", "none").slideDown(150);
}


/* OnLoad function for HTML body.  Initialise things when page is loaded. */
function OnLoad() {
    if( nDebugLevel > 0 ) $(".DebugClass").toggle( true );

    if( typeof( isOldIE ) != "undefined" ) {
        debug( 1, "Old version of IE detected, adding extra textarea events" );
        /* Old versions of IE need onkeypress event for textarea as well as onchange */
        $("#Source").on( "keypress change", TextareaChanged );
    }

    oTextarea = $("#Source")[0];
    TextareaChanged();

    VariantChanged(); /* Set up variant description */

    if( window.location.search != "" ) {
        SetStatusMessage( "Chargement de la machine sauvegardée..." );
        LoadFromCloud( window.location.search.substring( 1 ) );
        window.history.replaceState( null, "", window.location.pathname );  /* Remove query string from URL */
    } else {
        // LoadSampleProgram( 'palindrome', 'Default program', true );
        LoadSampleProgram( 'TP4--Q3-1', 'TP4 - Q3.1 (ENSAI, 2016)', true );
        SetStatusMessage( 'Chargez un programme avec le menu, ou écrivez le votre, et cliquez sur "Lancer" !' );
    }
}


/* for testing */
function testsave( success )
{
    if( success ) {
        saveSuccessCallback( {id: "!!!WHACK!!!" + $.now(), url: "http://wha.ck/xxx"} );
    } else {
        saveErrorCallback( {id: "!!!WHACK!!!" + $.now(), url: "http://wha.ck/xxx"}, null, {status: -1, statusText: 'dummy'} );
    }
}

/* return a string of n copies of c */
function repeat( c, n )
{
    var sTmp = "";
    while( n-- > 0 ) sTmp += c;
    return sTmp;
}


function debug( n, str )
{
    if( n <= 0 ) {
        SetStatusMessage( str );
        console.log( str );
    }
    if( nDebugLevel >= n  ) {
        $("#debug").append( document.createTextNode( str + "\n" ) );
        console.log( str );
    }
}

